"""Integration checks against the compiled native helper; uses disposable fake app bundles."""
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest

HELPER = os.environ.get('AEGIR_UPDATER_HELPER', '/tmp/aegir-updater-proof')

class UpdaterProof(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.target = self.bundle('Installed/Aegir.app', 'old')
        self.source = self.bundle('Download/Aegir.app', 'new')
        self.journal = Path(str(self.target) + '.aegir-update.json')
        self.backup = Path(str(self.target) + '.aegir-update-old')
        self.candidate = Path(str(self.target) + '.aegir-update-new')
        process = subprocess.Popen(['/usr/bin/true'])
        process.wait()
        self.exited_pid = str(process.pid)

    def tearDown(self):
        self.temp.cleanup()

    def bundle(self, name, version, identifier='dev.personal.aegir'):
        app = self.root / name
        (app / 'Contents/MacOS').mkdir(parents=True)
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': identifier, 'CFBundleExecutable': 'Aegir', 'CFBundleVersion': version,
        }))
        binary = app / 'Contents/MacOS/Aegir'
        binary.write_text('#!/bin/sh\nexit 0\n')
        binary.chmod(0o755)
        return app

    def invoke(self, *args, ok=True):
        result = subprocess.run([HELPER, *map(str, args)], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, ok, result.stderr)
        return result

    def install(self):
        self.invoke('install', self.target, self.source, self.exited_pid)

    def version(self):
        return plistlib.loads((self.target / 'Contents/Info.plist').read_bytes())['CFBundleVersion']

    def test_install_and_confirm(self):
        self.install()
        self.assertEqual(self.version(), 'new')
        self.assertTrue(self.backup.exists())
        self.invoke('confirm', self.journal)
        self.assertFalse(self.backup.exists())
        self.assertFalse(self.journal.exists())

    def test_recover_installed(self):
        self.install()
        self.invoke('recover', self.journal)
        self.assertEqual(self.version(), 'old')
        self.assertTrue(self.source.exists())

    def test_interrupted_after_backup(self):
        self.install()
        self.target.rename(self.candidate)
        receipt = json.loads(self.journal.read_text())
        receipt['phase'] = 'replacing'
        self.journal.write_text(json.dumps(receipt))
        self.invoke('recover', self.journal)
        self.assertEqual(self.version(), 'old')

    def test_interrupted_before_backup(self):
        receipt = dict(target=str(self.target), candidate=str(self.candidate), backup=str(self.backup), phase='staging')
        self.journal.write_text(json.dumps(receipt))
        self.invoke('recover', self.journal)
        self.assertEqual(self.version(), 'old')

    def test_reject_wrong_bundle(self):
        bad = self.bundle('Bad.app', 'bad', 'another.app')
        self.invoke('install', self.target, bad, self.exited_pid, ok=False)
        self.assertEqual(self.version(), 'old')
        self.assertFalse(self.journal.exists())

    def test_reject_second_install(self):
        self.install()
        self.invoke('install', self.target, self.source, self.exited_pid, ok=False)
        self.assertTrue(self.backup.exists())

    def test_reject_symlink_and_overlapping_paths(self):
        alias = self.root / 'Alias.app'
        alias.symlink_to(self.target)
        self.invoke('install', alias, self.source, self.exited_pid, ok=False)
        nested = self.bundle('Installed/Aegir.app/Nested.app', 'new')
        self.invoke('install', self.target, nested, self.exited_pid, ok=False)
        self.assertEqual(self.version(), 'old')

    def test_reject_tampered_receipt(self):
        self.install()
        receipt = json.loads(self.journal.read_text())
        receipt['backup'] = str(self.source)
        self.journal.write_text(json.dumps(receipt))
        self.invoke('recover', self.journal, ok=False)
        self.assertEqual(self.version(), 'new')
        self.assertTrue(self.source.exists())

if __name__ == '__main__':
    unittest.main()

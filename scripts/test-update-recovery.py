"""Opt-in macOS integration checks for interrupted-installation recovery.
Uses only disposable fake application bundles and SQLite files.
"""
import fcntl
import json
import os
from pathlib import Path
import plistlib
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
import uuid

HELPER = str(Path('build/aegir-updater').resolve())

class Recovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aegir-native-recovery-')
        self.root = Path(self.temp.name).resolve()
        self.profile = self.root / 'profile'
        self.transaction = self.profile / 'updates' / ('transaction-' + str(uuid.uuid4()))
        self.transaction.mkdir(parents=True)
        self.target = self.root / 'Aegir.app'
        self.bundle(self.target, '0.1.2')
        self.backup = Path(str(self.target) + '.aegir-update-old')
        self.bundle(self.backup, '0.1.1')
        for path, value in [(self.profile / 'aegir.sqlite', 'new'), (self.transaction / 'aegir.sqlite.backup', 'original')]:
            with sqlite3.connect(path) as db:
                db.execute('CREATE TABLE marker(value TEXT)')
                db.execute('INSERT INTO marker VALUES (?)', (value,))
        process = subprocess.Popen(['/usr/bin/true']); process.wait()
        self.pid = str(process.pid)
        self.token = str(uuid.uuid4())
        request = dict(target=str(self.target), source=str(self.profile / 'updates/download-test/Aegir.app'), parentPID=process.pid, token=self.token, root=str(self.transaction), userData=str(self.profile), version='0.1.2')
        self.request = self.transaction / 'request.json'
        self.request.write_text(json.dumps(request))
        (self.transaction / 'phase').write_text('starting')

    def tearDown(self):
        self.temp.cleanup()

    def bundle(self, path, version):
        (path / 'Contents/MacOS').mkdir(parents=True)
        (path / 'Contents/Info.plist').write_bytes(plistlib.dumps(dict(CFBundleIdentifier='dev.personal.aegir', CFBundleExecutable='Aegir', CFBundleShortVersionString=version, CFBundlePackageType='APPL')))
        shutil.copy('/usr/bin/true', path / 'Contents/MacOS/Aegir')

    def run_recovery(self):
        return subprocess.run([HELPER, str(self.request), '--recover', self.pid], capture_output=True, text=True, timeout=20)

    def marker(self):
        with sqlite3.connect(self.profile / 'aegir.sqlite') as db:
            return db.execute('SELECT value FROM marker').fetchone()[0]

    def test_restores_app_and_database_before_reopening(self):
        result = self.run_recovery()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.marker(), 'original')
        version = plistlib.loads((self.target / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
        self.assertEqual(version, '0.1.1')
        self.assertEqual(json.loads((self.transaction / 'result.json').read_text())['status'], 'rolledBack')

    def test_never_restores_after_healthy_startup(self):
        (self.transaction / 'healthy').write_text(self.token)
        result = self.run_recovery()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.marker(), 'new')
        self.assertTrue(self.backup.exists())

    @unittest.skipUnless(os.environ.get('AEGIR_TEST_FAILED_STARTUP') == '1', 'Opt-in two-minute failed-startup test')
    def test_failed_startup_automatically_restores_backup(self):
        shutil.rmtree(self.target)
        self.backup.rename(self.target)
        source = self.profile / 'updates/download-test/Aegir.app'
        self.bundle(source, '0.1.2')
        (self.transaction / 'shutdown-ready').write_text(self.token)
        result = subprocess.run([HELPER, str(self.request)], capture_output=True, text=True, timeout=150)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((self.transaction / 'result.json').read_text())
        self.assertEqual(receipt['status'], 'rolledBack', receipt)
        self.assertEqual(self.marker(), 'original')
        self.assertEqual(plistlib.loads((self.target / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString'], '0.1.1')

    def test_concurrent_installer_lock_preserves_files(self):
        with open(str(self.target) + '.aegir-update.lock', 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_recovery()
            self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.marker(), 'new')
        self.assertTrue(self.backup.exists())

if __name__ == '__main__':
    unittest.main()

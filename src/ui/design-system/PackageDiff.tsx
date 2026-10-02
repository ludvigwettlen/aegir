import type { SkillFile } from '../../../shared/skills';

export function PackageDiff({ before, after }: { before: SkillFile[]; after: SkillFile[] }) {
  const paths = [...new Set([...before, ...after].map(f => f.path))].filter(path => JSON.stringify(before.find(f => f.path === path)) !== JSON.stringify(after.find(f => f.path === path)));
  return <>{paths.map(path => { const old = before.find(f => f.path === path); const next = after.find(f => f.path === path); return <div key={path}><h4>{path} · {!old ? 'Added' : !next ? 'Removed' : 'Changed'}</h4><div className="skill-diff"><div><strong>Before</strong><pre>{old ? old.encoding === 'utf8' ? old.content : '[Binary asset]' : '(No file)'}</pre></div><div><strong>Proposed</strong><pre>{next ? next.encoding === 'utf8' ? next.content : '[Binary asset]' : '(Removed)'}</pre></div></div></div>; })}</>;
}

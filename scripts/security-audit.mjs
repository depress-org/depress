import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Offline renderer: never installs, updates or executes the dependency tree.
export function inventory(audit, lock) {
  if (audit.auditReportVersion !== 2 || !audit.vulnerabilities || !lock.packages) {
    throw new Error('Expected npm audit v2 and package-lock packages');
  }
  const packages = Object.entries(audit.vulnerabilities).sort(([a], [b]) => a.localeCompare(b)).map(([name, finding]) => ({
    name,
    severity: finding.severity,
    nodes: finding.nodes.map(path => {
      const version = lock.packages[path]?.version;
      if (!version) throw new Error(`Missing lock entry: ${path}`);
      return { path, version };
    }),
    propagatedVia: finding.via.filter(item => typeof item === 'string'),
    fixAvailable: finding.fixAvailable,
  }));
  if (packages.length !== audit.metadata.vulnerabilities.total) throw new Error('Audit total does not match package count');
  const advisories = new Map();
  for (const finding of Object.values(audit.vulnerabilities)) {
    for (const item of finding.via) {
      if (typeof item === 'string') continue;
      const previous = advisories.get(item.url);
      if (previous && (previous.package !== item.name || previous.affected !== item.range)) throw new Error(`Conflicting advisory: ${item.url}`);
      advisories.set(item.url, { package: item.name, severity: item.severity, title: item.title, url: item.url, affected: item.range });
    }
  }
  return { counts: audit.metadata.vulnerabilities, packages, advisories: [...advisories.values()].sort((a, b) => a.url.localeCompare(b.url)) };
}

export function markdown(data) {
  const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const rows = data.packages.map(p => `| ${p.name} | ${p.severity} | ${p.nodes.map(n => `${n.path}: ${n.version}`).join('<br>')} | ${p.propagatedVia.join(', ') || 'direct advisory'} |`);
  const advisories = data.advisories.map(a => `| [${a.url.split('/').pop()}](${a.url}) | ${a.package} | ${a.severity} | ${escape(a.affected)} | ${escape(a.title)} |`);
  return `# Exact advisory inventory\n\nGenerated offline by scripts/security-audit.mjs from the baseline npm audit and baseline lock.\nPackage findings: ${data.packages.length}; distinct direct advisories: ${data.advisories.length}.\nA propagated package finding is not another distinct vulnerability. Reachability and remediation are in README.md.\n\n| Package | Maximum severity | Exact locked nodes | Propagated via |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n| Advisory | Package | Severity | Affected versions (registry snapshot) | Title |\n| --- | --- | --- | --- | --- |\n${advisories.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/security-audit.mjs AUDIT_JSON LOCK_JSON');
  console.log(markdown(inventory(JSON.parse(readFileSync(process.argv[2], 'utf8')), JSON.parse(readFileSync(process.argv[3], 'utf8')))));
}

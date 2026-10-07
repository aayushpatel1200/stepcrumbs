// Shared helpers for the side panel, editor and exporters.
export const APP = {
  name: 'StepCrumbs',
  tagline: 'Turn your clicks into step-by-step guides',
  repo: 'https://github.com/aayushpatel1200/stepcrumbs'
};
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Titles use a tiny markdown subset: **bold** and `code`
export function inlineMd(s) {
  const parts = String(s ?? '').split(/(`[^`]+`)/g);
  return parts.map(p => {
    if (/^`[^`]+`$/.test(p)) return `<code>${esc(p.slice(1, -1))}</code>`;
    return esc(p).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }).join('');
}
export const stripMd = s => String(s ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');

export function fmtDuration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
export function humanDuration(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
export const slugify = s => (String(s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'project';

export const NOTE_KINDS = {
  challenge: { label: 'Challenge', color: '#ef4444', hint: 'What was hard, confusing or broke?' },
  solution: { label: 'Solution', color: '#16a34a', hint: 'How you fixed it / what finally worked' },
  tip: { label: 'Tip', color: '#2563eb', hint: 'A lesson learned or shortcut worth sharing' },
  note: { label: 'Note', color: '#9333ea', hint: 'Anything else worth remembering' }
};

export const ICONS = {
  rec: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="7" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 19L7 7M7 15V7h8"/></svg>',
  blur: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3" y="3" width="5" height="5" rx="1" opacity=".9"/><rect x="10" y="3" width="5" height="5" rx="1" opacity=".5"/><rect x="17" y="3" width="4" height="5" rx="1" opacity=".8"/><rect x="3" y="10" width="5" height="5" rx="1" opacity=".4"/><rect x="10" y="10" width="5" height="5" rx="1" opacity=".9"/><rect x="17" y="10" width="4" height="5" rx="1" opacity=".5"/><rect x="3" y="17" width="5" height="4" rx="1" opacity=".7"/><rect x="10" y="17" width="5" height="4" rx="1" opacity=".4"/><rect x="17" y="17" width="4" height="4" rx="1" opacity=".9"/></svg>',
  redact: '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="7" width="18" height="10" rx="2" fill="currentColor"/></svg>',
  crop: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v16h16M2 6h16v16"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  note: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M9 9h6M9 13h4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>'
};

// Project types: drive the wording of exports, the LinkedIn post and hashtags.
export const CATEGORIES = {
  homelab: { label: 'Homelab', eyebrow: 'Homelab project', where: 'in my homelab', more: 'homelab builds', tags: ['homelab', 'selfhosted'], ask: 'What should I build next in the lab?' },
  cloud: { label: 'Cloud (AWS / Azure / GCP)', eyebrow: 'Cloud project', where: 'in the cloud', more: 'cloud projects', tags: ['cloud', 'cloudcomputing'], ask: 'What should I build next in the cloud?' },
  devops: { label: 'DevOps / automation', eyebrow: 'DevOps project', where: '', more: 'DevOps projects', tags: ['devops', 'automation'], ask: 'What would you automate next?' },
  networking: { label: 'Networking', eyebrow: 'Networking project', where: 'on my network', more: 'networking projects', tags: ['networking', 'itinfrastructure'], ask: 'What should I set up next?' },
  security: { label: 'Cybersecurity', eyebrow: 'Security project', where: 'in my lab', more: 'security projects', tags: ['cybersecurity', 'infosec'], ask: 'What should I dig into next?' },
  dev: { label: 'Software / web dev', eyebrow: 'Dev project', where: '', more: 'dev projects', tags: ['softwaredevelopment', 'webdev'], ask: 'What should I build next?' },
  general: { label: 'General how-to', eyebrow: 'Step-by-step guide', where: '', more: 'step-by-step guides', tags: ['learninginpublic', 'howto'], ask: 'What should I document next?' }
};

// Recognise the tech stack from page titles, hosts and commands (used as tag suggestions)
const STACK = [
  // homelab
  [/proxmox|\bpve\b|\bqm\s|\bpct\s/i, 'Proxmox VE'], [/truenas/i, 'TrueNAS'], [/pfsense/i, 'pfSense'], [/opnsense/i, 'OPNsense'],
  [/home assistant/i, 'Home Assistant'], [/portainer/i, 'Portainer'], [/pi-?hole/i, 'Pi-hole'], [/unraid/i, 'Unraid'],
  [/nginx proxy manager/i, 'Nginx Proxy Manager'], [/tailscale/i, 'Tailscale'], [/wireguard|\bwg-quick\b/i, 'WireGuard'],
  [/jellyfin/i, 'Jellyfin'], [/\bplex\b/i, 'Plex'], [/nextcloud/i, 'Nextcloud'], [/adguard/i, 'AdGuard Home'], [/uptime kuma/i, 'Uptime Kuma'],
  // cloud
  [/console\.aws\.amazon\.com|amazonaws\.com|\baws\s+\w|aws management console/i, 'AWS'],
  [/\bEC2\b/, 'EC2'], [/\bS3\b|\bs3:\/\//, 'S3'], [/\bIAM\b/, 'IAM'], [/\bVPC\b/, 'VPC'], [/\bLambda\b/, 'Lambda'], [/\bRDS\b/, 'RDS'],
  [/CloudFormation/, 'CloudFormation'], [/CloudWatch/, 'CloudWatch'], [/Route ?53/, 'Route 53'], [/\bEKS\b/, 'EKS'], [/\bECS\b/, 'ECS'],
  [/DynamoDB/, 'DynamoDB'], [/API Gateway/, 'API Gateway'], [/CloudFront/, 'CloudFront'], [/\bCloudShell\b/, 'CloudShell'],
  [/portal\.azure\.com|microsoft azure|\baz\s+(vm|group|aks|login)\b/i, 'Azure'], [/entra/i, 'Microsoft Entra ID'],
  [/console\.cloud\.google\.com|google cloud|\bgcloud\s/i, 'Google Cloud'],
  [/digitalocean/i, 'DigitalOcean'], [/cloudflare/i, 'Cloudflare'], [/vercel\.com/i, 'Vercel'], [/netlify/i, 'Netlify'],
  // devops / dev
  [/\bdocker\b/i, 'Docker'], [/kubectl|\bk3s\b|kubernetes/i, 'Kubernetes'], [/\bhelm\s/i, 'Helm'], [/ansible/i, 'Ansible'], [/terraform/i, 'Terraform'],
  [/github\.com|\bgh\s+\w/i, 'GitHub'], [/github actions|\.github\/workflows/i, 'GitHub Actions'], [/gitlab/i, 'GitLab'], [/jenkins/i, 'Jenkins'],
  [/argo ?cd/i, 'Argo CD'], [/grafana/i, 'Grafana'], [/prometheus/i, 'Prometheus'], [/\bnginx\b/i, 'Nginx'], [/traefik/i, 'Traefik'],
  [/\bnpm\s|node\.js/i, 'Node.js'], [/\bpip3?\s|python/i, 'Python'],
  // storage / os / security
  [/\bzfs\b|\bzpool\b/i, 'ZFS'], [/ubuntu/i, 'Ubuntu'], [/debian/i, 'Debian'], [/\bapt(-get)?\s/i, 'Linux'],
  [/wazuh/i, 'Wazuh'], [/splunk/i, 'Splunk'], [/security onion/i, 'Security Onion'], [/kibana|elasticsearch/i, 'Elastic'], [/\bvlan\b/i, 'VLANs']
];
export function detectStack(items) {
  const hays = items.map(it => {
    let host = '';
    try { host = it.url ? new URL(it.url).hostname : ''; } catch (_) {}
    return `${it.pageTitle || ''} ${host} ${it.code || ''} ${it.title || ''}`;
  });
  const found = new Set();
  for (const [re, name] of STACK) if (hays.some(h => re.test(h))) found.add(name); // list order = platform first, then services
  // keep the list short and meaningful
  if (found.has('Debian') || found.has('Ubuntu')) found.delete('Linux');
  return [...found].slice(0, 10);
}
const CLOUD = ['AWS', 'Azure', 'Google Cloud', 'EC2', 'S3', 'Lambda', 'DigitalOcean'];
const LAB = ['Proxmox VE', 'TrueNAS', 'pfSense', 'OPNsense', 'Unraid', 'Home Assistant', 'Pi-hole', 'Jellyfin', 'Plex', 'AdGuard Home'];
const OPS = ['Terraform', 'Ansible', 'Kubernetes', 'GitHub Actions', 'Jenkins', 'Argo CD', 'Helm'];
const SEC = ['Wazuh', 'Splunk', 'Security Onion', 'Elastic'];
/** The project's type: chosen in the editor, or guessed from the stack. */
export function categoryOf(project, items) {
  if (project && project.category && CATEGORIES[project.category]) return project.category;
  const s = detectStack(items || []);
  if (s.some(x => CLOUD.includes(x))) return 'cloud';
  if (s.some(x => LAB.includes(x))) return 'homelab';
  if (s.some(x => SEC.includes(x))) return 'security';
  if (s.some(x => OPS.includes(x))) return 'devops';
  if (s.includes('pfSense') || s.includes('OPNsense') || s.includes('VLANs')) return 'networking';
  return 'general';
}

export const isPrivateIP = ip => {
  const p = ip.split('.').map(Number);
  if (p.some(x => x > 255)) return true; // not an IP (version numbers etc.)
  const [a, b] = p;
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || a === 255 ||
    ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '149.112.112.112'].includes(ip);
};

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

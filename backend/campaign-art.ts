// A cartoon picture for a campaign, drawn from the app's name and description:
// one friendly object chosen from what the app is about (a bowl for food, a book
// for learning, a camera for photos, a speech bubble for social apps, a laptop for
// software, a soft box otherwise), with the Dealoop two-ring eyes and a smile, in
// Dealoop's greens, and the app's name underneath. Deterministic SVG: no model or
// image API, the same picture every time for the same app.

const C = {dark: '#124d3f', teal: '#27b993', mint: '#9be0ba', side: '#6cc59c', pale: '#e8f7e4', cream: '#f8f2dc', white: '#ffffff'};

export type ArtKind = 'pet' | 'tennis' | 'music' | 'bowl' | 'book' | 'camera' | 'bubble' | 'laptop' | 'box';

const KINDS: [ArtKind, RegExp][] = [
  ['pet', /\b(pet|pets|dog|dogs|cat|cats|puppy|puppies|kitten\w*|vet|vets|veterinar\w*|grooming)\b/i],
  ['tennis', /\b(tennis|racket|racquet|pickleball|padel|badminton|squash)\b/i],
  ['music', /\b(music|musical|instrument\w*|guitar\w*|piano|violin|drum\w*|ukulele|song|songs|chord\w*)\b/i],
  ['bowl', /\b(food|meal|meals|recipe|recipes|cook|cooking|eat|eating|snack|kitchen|lunch|dinner|breakfast|nutrition|diet|restaurant|grocer\w*)\b/i],
  ['book', /\b(book|books|read|reading|learn|learning|study|course|courses|school|education|tutor\w*|language|quiz|homework|lesson\w*)\b/i],
  ['camera', /\b(photo|photos|camera|picture|pictures|video|videos|film|selfie|snap)\b/i],
  ['bubble', /\b(chat|message|messages|messaging|social|community|friends|dating|marketplace|network|creator|creators|influencer\w*)\b/i],
  ['laptop', /\b(developer\w*|code|coding|api|software|saas|agent|agents|ai|programming|startup|founder\w*|productivity|tool|tools)\b/i],
];

export function artKind(name: string, description: string): ArtKind {
  const text = `${name} ${description}`;
  return KINDS.find(([, re]) => re.test(text))?.[0] ?? 'box';
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'})[c]!);

/** The two-ring eyes and a smile, centred at (x, y), scaled by s. `glasses` joins the rings with a bridge. */
function face(x: number, y: number, s: number, glasses = false) {
  const d = 92 * s, r = 80 * s, w = 34 * s;
  const eye = (cx: number, color: string, dir: number) => `<circle cx="${cx}" cy="${y}" r="${r}" fill="${C.pale}" stroke="${color}" stroke-width="${w}"/>`
    + `<circle cx="${cx + dir * 8 * s}" cy="${y + 4 * s}" r="${22 * s}" fill="${C.dark}"/><circle cx="${cx + dir * 8 * s - 7 * s}" cy="${y - 4 * s}" r="${6 * s}" fill="${C.white}"/>`;
  const bridge = glasses ? `<rect x="${x - 34 * s}" y="${y - 16 * s}" width="${68 * s}" height="${30 * s}" rx="${15 * s}" fill="${C.dark}"/>` : '';
  const smile = `<path d="M${x - 44 * s} ${y + 132 * s} Q${x} ${y + 176 * s} ${x + 44 * s} ${y + 132 * s}" fill="none" stroke="${C.dark}" stroke-width="${18 * s}" stroke-linecap="round"/>`;
  return eye(x - d, C.dark, 1) + eye(x + d, C.teal, -1) + bridge + smile;
}

function body(kind: ArtKind): string {
  switch (kind) {
    case 'pet': return [
      `<ellipse cx="250" cy="430" rx="96" ry="190" transform="rotate(18 250 430)" fill="${C.side}"/>`,
      `<ellipse cx="774" cy="430" rx="96" ry="190" transform="rotate(-18 774 430)" fill="${C.side}"/>`,
      `<rect x="232" y="250" width="560" height="560" rx="260" fill="${C.mint}"/>`,
      `<ellipse cx="512" cy="660" rx="190" ry="130" fill="${C.pale}"/>`,
      face(512, 470, 0.86),
      `<ellipse cx="512" cy="548" rx="40" ry="26" fill="${C.dark}"/>`,
    ].join('');
    case 'tennis': return [
      `<circle cx="512" cy="520" r="318" fill="${C.side}"/><circle cx="496" cy="508" r="318" fill="${C.mint}"/>`,
      `<path d="M226 360 C360 420 360 620 232 690" fill="none" stroke="${C.pale}" stroke-width="30" stroke-linecap="round"/>`,
      `<path d="M766 350 C632 420 632 620 760 700" fill="none" stroke="${C.pale}" stroke-width="30" stroke-linecap="round"/>`,
      face(496, 470, 0.8),
    ].join('');
    case 'music': return [
      `<rect x="474" y="96" width="76" height="330" rx="20" fill="${C.dark}"/><rect x="450" y="70" width="124" height="96" rx="30" fill="${C.dark}"/>`,
      `<circle cx="512" cy="430" r="160" fill="${C.side}"/><circle cx="512" cy="640" r="230" fill="${C.side}"/>`,
      `<circle cx="500" cy="424" r="156" fill="${C.mint}"/><circle cx="500" cy="634" r="226" fill="${C.mint}"/>`,
      `<ellipse cx="500" cy="600" rx="180" ry="150" fill="${C.pale}"/>`,
      `<rect x="420" y="770" width="160" height="34" rx="17" fill="${C.dark}"/>`,
      face(500, 560, 0.72),
    ].join('');
    case 'bowl': return [
      ...[400, 512, 624].map(x => `<path d="M${x} 330 q-26 -40 0 -80 q26 -40 0 -80" fill="none" stroke="${C.mint}" stroke-width="20" stroke-linecap="round"/>`),
      `<path d="M172 470 L852 470 A340 300 0 0 1 172 470 Z" fill="${C.mint}"/>`,
      `<path d="M852 470 A340 300 0 0 1 640 742 A300 280 0 0 0 800 470 Z" fill="${C.side}"/>`,
      `<ellipse cx="512" cy="470" rx="340" ry="58" fill="${C.side}"/><ellipse cx="512" cy="466" rx="306" ry="38" fill="${C.cream}"/>`,
      `<circle cx="420" cy="452" r="30" fill="${C.teal}"/><circle cx="560" cy="446" r="24" fill="${C.side}"/><circle cx="640" cy="458" r="20" fill="${C.teal}"/>`,
      `<rect x="402" y="752" width="220" height="42" rx="20" fill="${C.dark}"/>`,
      face(512, 588, 0.72),
    ].join('');
    case 'book': return [
      `<rect x="128" y="300" width="768" height="500" rx="96" fill="${C.dark}"/>`,
      `<path d="M512 340 C430 280 280 272 196 300 L188 748 C292 712 420 716 512 778 Z" fill="${C.cream}"/>`,
      `<path d="M512 340 C594 280 744 272 828 300 L836 748 C732 712 604 716 512 778 Z" fill="${C.cream}"/>`,
      `<path d="M188 748 C292 712 420 716 512 778 C604 716 732 712 836 748 L836 700 C732 664 604 670 512 730 C420 670 292 664 188 700 Z" fill="${C.pale}"/>`,
      face(512, 520, 0.92, true),
    ].join('');
    case 'camera': return [
      `<rect x="372" y="262" width="230" height="110" rx="34" fill="${C.side}"/>`,
      `<rect x="164" y="330" width="696" height="450" rx="96" fill="${C.mint}"/>`,
      `<rect x="224" y="396" width="576" height="330" rx="80" fill="${C.pale}"/>`,
      `<rect x="704" y="356" width="80" height="26" rx="13" fill="${C.dark}"/>`,
      face(512, 540, 0.95),
    ].join('');
    case 'bubble': return [
      `<path d="M300 690 L232 840 L452 720 Z" fill="${C.side}"/>`,
      `<rect x="148" y="226" width="728" height="500" rx="210" fill="${C.mint}"/>`,
      `<rect x="212" y="290" width="600" height="372" rx="170" fill="${C.pale}"/>`,
      face(512, 462, 0.95),
    ].join('');
    case 'laptop': return [
      `<rect x="226" y="224" width="572" height="430" rx="54" fill="${C.dark}"/>`,
      `<rect x="258" y="256" width="508" height="366" rx="32" fill="${C.pale}"/>`,
      `<path d="M148 684 L876 684 L822 780 L202 780 Z" fill="${C.mint}"/><rect x="452" y="684" width="120" height="24" rx="12" fill="${C.side}"/>`,
      face(512, 420, 0.78),
    ].join('');
    default: return [
      `<rect x="206" y="270" width="634" height="520" rx="160" fill="${C.side}"/>`,
      `<rect x="168" y="258" width="634" height="520" rx="160" fill="${C.mint}"/>`,
      `<rect x="230" y="320" width="510" height="398" rx="116" fill="${C.pale}"/>`,
      `<rect x="292" y="768" width="78" height="72" rx="26" fill="${C.dark}"/><rect x="632" y="768" width="78" height="72" rx="26" fill="${C.dark}"/>`,
      face(485, 500, 0.95),
    ].join('');
  }
}

export function campaignArt(name: string, description: string): string {
  const title = name.trim().slice(0, 40) || 'Your app';
  const size = Math.max(44, Math.min(104, Math.floor(1500 / Math.max(1, title.length))));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="${esc(title)}">`
    + `<rect width="1024" height="1024" fill="${C.white}"/>`
    + `<g transform="translate(0 -40)">${body(artKind(title, description))}</g>`
    + `<text x="512" y="948" text-anchor="middle" font-family="Manrope, 'DM Sans', 'Avenir Next', 'Helvetica Neue', Arial, sans-serif" font-weight="800" font-size="${size}" fill="${C.dark}">${esc(title)}</text>`
    + `</svg>`;
}

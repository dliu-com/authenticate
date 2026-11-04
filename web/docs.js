const sections = ['architecture', 'cost', 'security', 'api', 'health'];
const links = [...document.querySelectorAll('.dl-tabs a')];

function colorIcons() {
  const tierColors = new Map(['dg-untrusted', 'dg-edge', 'dg-app', 'dg-private'].map((tier) => {
    const badge = document.querySelector(`#architecture .${tier} .dg-badge`);
    return [tier, getComputedStyle(badge).backgroundColor];
  }));
  for (const icon of document.querySelectorAll('.dg-icon[data-dg-tier]')) {
    const tier = icon.getAttribute('data-dg-tier');
    if (!tierColors.has(tier)) throw new Error('Unknown documentation icon tier');
    icon.style.setProperty('--dg', tierColors.get(tier));
  }
}

function showSection() {
  const requested = window.location.hash.slice(1);
  const selected = sections.includes(requested) ? requested : 'architecture';
  for (const section of sections) {
    document.getElementById(section).hidden = section !== selected;
  }
  for (const link of links) {
    if (link.hash === `#${selected}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const title = links.find((link) => link.hash === `#${selected}`).textContent;
  document.title = `${title} | Docs | DL auth`;
}

window.addEventListener('hashchange', showSection);
showSection();
if (document.readyState === 'complete') colorIcons();
else window.addEventListener('load', colorIcons, { once: true });

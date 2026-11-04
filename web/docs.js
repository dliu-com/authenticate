const sections = ['architecture', 'cost', 'security', 'api', 'health'];
const links = [...document.querySelectorAll('.dl-tabs a')];

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

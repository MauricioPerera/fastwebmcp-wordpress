const copyStatus = document.getElementById('copy-status');
document.querySelectorAll('.code-sample').forEach(sample => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-button';
  button.textContent = 'Copiar';
  const label = sample.querySelector('.code-heading span').textContent;
  button.setAttribute('aria-label', `Copiar código: ${label}`);
  sample.querySelector('.code-heading').append(button);
  let timer;
  button.addEventListener('click', async () => {
    clearTimeout(timer);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(sample.querySelector('pre code').textContent);
      button.textContent = 'Copiado';
      copyStatus.textContent = `Código copiado: ${label}.`;
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(sample.querySelector('pre code'));
      selection?.removeAllRanges();
      selection?.addRange(range);
      button.textContent = 'Seleccionado';
      copyStatus.textContent = `Código seleccionado: ${label}. Usa la opción de copiar de tu navegador.`;
    }
    timer = setTimeout(() => { button.textContent = 'Copiar'; }, 2500);
  });
});

const tocLinks = [...document.querySelectorAll('.doc-sidebar nav a')];
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    const visible = entries.find(entry => entry.isIntersecting);
    if (!visible) return;
    tocLinks.forEach(link => {
      if (link.hash === `#${visible.target.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-10% 0px -65% 0px', threshold: 0 });
  document.querySelectorAll('.doc-content section').forEach(section => observer.observe(section));
}

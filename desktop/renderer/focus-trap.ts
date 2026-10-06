/** Minimal focus trap for modal overlays. */
export function initGlobalFocusTrap(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const visibleModals = document.querySelectorAll('.modal-overlay:not(.hidden)');
    if (visibleModals.length === 0) return;
    const activeModal = visibleModals[visibleModals.length - 1] as HTMLElement;
    const focusable = Array.from(activeModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) as HTMLElement[];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement as HTMLElement;
    if (e.shiftKey && current === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && current === last) {
      first.focus();
      e.preventDefault();
    }
  });
}

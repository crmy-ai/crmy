import { useEffect, type RefObject } from 'react';

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  const role = target.getAttribute('role');
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable ||
    role === 'textbox' ||
    role === 'combobox' ||
    role === 'searchbox'
  );
}

export function useSlashSearchFocus<T extends HTMLElement>(ref: RefObject<T>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/' || isEditableTarget(event.target)) return;
      event.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, ref]);
}

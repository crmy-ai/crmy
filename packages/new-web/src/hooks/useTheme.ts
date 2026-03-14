import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';

type Theme = 'light' | 'dark';

export function useTheme() {
  const { darkVariant } = useAppStore();
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('charcoal', theme === 'dark' && darkVariant === 'charcoal');
    localStorage.setItem('theme', theme);
  }, [theme, darkVariant]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return { theme, setTheme, toggle };
}

import { useEffect } from 'react';

/// The page title and description (the site also writes social tags and prerenders them).
export function useSeo({ title, description }) {
  useEffect(() => {
    if (title) document.title = title;
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.append(m); }
    if (description) m.content = description;
  }, [title, description]);
}

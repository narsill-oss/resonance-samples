import React from 'react';
import { Link as RouterLink } from 'react-router-dom';

/// In-app links (the site version also maps a few paths to its other sites).
export function Link({ to, children, ...rest }) {
  return <RouterLink to={to} {...rest}>{children}</RouterLink>;
}

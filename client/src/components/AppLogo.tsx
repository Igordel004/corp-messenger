import { Link } from 'react-router';

interface AppLogoProps {
  className?: string;
}

export const AppLogo = ({ className }: AppLogoProps) => (
  <Link to="/" className={['logo', className].filter(Boolean).join(' ')} aria-label="На главную">
    <span className="logo__mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A1 1 0 0 1 4.3 19v-3.1A2.5 2.5 0 0 1 4 14.5v-9Z" />
      </svg>
    </span>
    <span className="logo__text">Мессенджер</span>
  </Link>
);

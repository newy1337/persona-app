export const AVATAR_BG = {
  blue: 'linear-gradient(135deg, #1A2A4A 0%, rgba(0,0,0,0.40) 100%)',
  green: 'linear-gradient(135deg, #1A4A3A 0%, rgba(0,0,0,0.40) 100%)',
  orange: 'linear-gradient(135deg, #3A2A1A 0%, rgba(0,0,0,0.40) 100%)',
  purple: 'linear-gradient(135deg, #2A1A3A 0%, rgba(0,0,0,0.40) 100%)',
  teal: 'linear-gradient(135deg, #1A3A4A 0%, rgba(0,0,0,0.40) 100%)',
};

export function getInitials(name) {
  const parts = name.split(' ');
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}
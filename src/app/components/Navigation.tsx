'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation() {
  const pathname = usePathname();

  const navItems = [
    { href: '/research', label: 'Research' },
    { href: '/', label: 'Search' },
    { href: '/documents', label: 'Documents' },
  ];

  const isActive = (href: string) => {
    if (href === '/research') {
      return pathname === '/research' || pathname.startsWith('/research/');
    }

    return pathname === href;
  };

  return (
    <nav className="mb-8 border-b border-stone-200 bg-white/80 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-8">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                isActive(item.href)
                  ? 'border-slate-900 text-slate-950'
                  : 'border-transparent text-slate-500 hover:border-stone-300 hover:text-slate-700'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

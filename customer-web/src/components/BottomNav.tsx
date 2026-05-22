import { useRouter } from 'next/router';
import { Home, ClipboardList, ShoppingBag, Heart, User } from 'lucide-react';

const navItems = [
  { label: 'الرئيسية', icon: Home, path: '/' },
  { label: 'طلباتي', icon: ClipboardList, path: '/orders' },
  { label: 'السلة', icon: ShoppingBag, path: '/cart' },
  { label: 'المفضلة', icon: Heart, path: '/favorites' },
  { label: 'الحساب', icon: User, path: '/account' },
];

export default function BottomNav() {
  const router = useRouter();
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-2 z-50">
      {navItems.map((item) => {
        const isActive = router.pathname === item.path;
        return (
          <button
            key={item.path}
            onClick={() => router.push(item.path)}
            className={`flex flex-col items-center text-xs ${
              isActive ? 'text-primary' : 'text-gray-500'
            }`}
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
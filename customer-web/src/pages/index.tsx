import { useEffect, useState } from 'react';
import axios from 'axios';
import BottomNav from '@/components/BottomNav';
import RestaurantCard from '@/components/RestaurantCard';

export default function Home() {
  const [restaurants, setRestaurants] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    axios.get('/api/restaurants').then(res => setRestaurants(res.data));
  }, []);

  const filtered = restaurants.filter(r => r.name.includes(search));

  return (
    <div className="pb-20 min-h-screen bg-gray-50">
      <div className="bg-primary p-4 pt-8 text-white">
        <h1 className="text-3xl font-bold">Drako</h1>
        <p className="text-sm opacity-90">توصيل لحد باب البيت</p>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ابحث عن مطعم..."
          className="mt-4 w-full rounded-xl p-3 text-black"
        />
      </div>
      <div className="p-4 grid gap-4">
        {filtered.map(r => <RestaurantCard key={r.id} restaurant={r} />)}
      </div>
      <BottomNav />
    </div>
  );
}
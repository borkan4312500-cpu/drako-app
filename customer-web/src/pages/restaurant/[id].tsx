import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import axios from 'axios';

export default function Menu() {
  const router = useRouter();
  const { id } = router.query;
  const [restaurant, setRestaurant] = useState<any>(null);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [cart, setCart] = useState<any[]>([]);

  useEffect(() => {
    if (id) axios.get(`/api/restaurants/${id}`).then(res => {
      setRestaurant(res.data);
      setCategories(res.data.categories);
    });
  }, [id]);

  const addToCart = (product: any, size?: any, extras?: any[]) => {
    // أضف للسلة المحلية (يمكن استخدام Context لاحقاً)
    setCart([...cart, { product, size, extras, quantity: 1 }]);
  };

  return (
    <div className="pb-20">
      {restaurant && (
        <>
          <div className="bg-primary p-4 text-white">
            <h2>{restaurant.name}</h2>
            <p>⭐ {restaurant.rating} | ⏱️ {restaurant.avgPrepTime} د</p>
          </div>
          {/* تصنيفات أفقية */}
          <div className="p-2 flex gap-2 overflow-x-auto">
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                className={`px-4 py-1 rounded-full ${activeCategory === cat.id ? 'bg-primary text-white' : 'bg-gray-200'}`}>
                {cat.name}
              </button>
            ))}
          </div>
          {/* المنتجات */}
          <div className="p-4 grid gap-4">
            {categories.filter(c => activeCategory === 'all' || c.id === activeCategory)
              .map(cat => cat.products.map(prod => (
                <div key={prod.id} className="bg-white rounded-xl p-4 flex gap-4 shadow">
                  <img src={prod.images[0]} className="w-20 h-20 rounded-xl object-cover" />
                  <div className="flex-1">
                    <h4 className="font-bold">{prod.name}</h4>
                    <p className="text-gray-500 text-sm">{prod.description}</p>
                    <p className="text-primary font-bold mt-1">{prod.basePrice} ج.م</p>
                    <button onClick={() => addToCart(prod)} className="mt-2 bg-primary text-white px-3 py-1 rounded-full text-sm">
                      + إضافة
                    </button>
                  </div>
                </div>
              )))}
          </div>
        </>
      )}
    </div>
  );
}
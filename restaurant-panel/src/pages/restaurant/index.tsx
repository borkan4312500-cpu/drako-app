import { withAuth } from '@drako/ui/withAuth';
import Layout from '@drako/ui/Layout';
import { useEffect, useState } from 'react';
import axios from 'axios';

function Dashboard() {
  const [stats, setStats] = useState<any>({});
  useEffect(() => {
    axios.get('/api/restaurants/my-stats').then(res => setStats(res.data));
  }, []);
  return (
    <Layout role="restaurant" title="لوحة التحكم">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl shadow">طلبات اليوم: {stats.todayOrders}</div>
        <div className="bg-white p-4 rounded-xl shadow">الأرباح: {stats.earnings} ج.م</div>
        <div className="bg-white p-4 rounded-xl shadow">المنتجات: {stats.productCount}</div>
      </div>
    </Layout>
  );
}
export default withAuth(Dashboard, ['RESTAURANT']);
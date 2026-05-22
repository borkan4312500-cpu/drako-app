import { withAuth } from '@drako/ui/withAuth';
import Layout from '@drako/ui/Layout';
import { useEffect, useState } from 'react';
import axios from 'axios';

function DriverDashboard() {
  const [availableOrders, setAvailableOrders] = useState([]);
  const [earnings, setEarnings] = useState(0);

  useEffect(() => {
    axios.get('/api/driver/available-orders').then(res => setAvailableOrders(res.data));
    axios.get('/api/driver/earnings').then(res => setEarnings(res.data.total));
  }, []);

  const acceptOrder = async (orderId: string) => {
    await axios.patch(`/api/driver/orders/${orderId}/accept`);
    // تحديث القائمة
  };

  return (
    <Layout role="driver" title="لوحة الطيار">
      <div className="mb-4">أرباحي: {earnings} ج.م</div>
      {availableOrders.map(order => (
        <div key={order.id} className="bg-white p-4 rounded-xl shadow mb-2 flex justify-between">
          <div>
            <p>العميل: {order.customer.name}</p>
            <p>العنوان: {order.customer.address}</p>
          </div>
          <button onClick={() => acceptOrder(order.id)} className="bg-primary text-white px-4 py-2 rounded-xl">قبول</button>
        </div>
      ))}
    </Layout>
  );
}
export default withAuth(DriverDashboard, ['DRIVER']);
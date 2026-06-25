import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="dashboard">
      <h1 className="dashboard-title">Select Module</h1>
      <div className="dashboard-cards">
        <div className="dashboard-card" onClick={() => navigate('/calendar')}>
          <div className="card-icon calendar-icon">📅</div>
          <h2>Calendar</h2>
          <p>Schedule Management - Create, view and manage your schedule</p>
        </div>
        <div className="dashboard-card" onClick={() => navigate('/chinabidding')}>
          <div className="card-icon bid-icon">📋</div>
          <h2>ChinaBidding</h2>
          <p>Tender Information - Scrape and analyze China bidding website projects</p>
        </div>
        <div className="dashboard-card" onClick={() => navigate('/customers')}>
          <div className="card-icon customer-icon">🤝</div>
          <h2>Customers</h2>
          <p>CRM - Manage customers, tiers, tags, visit history and map distribution</p>
        </div>
        <div className="dashboard-card" onClick={() => navigate('/trips')}>
          <div className="card-icon trip-icon">🗺️</div>
          <h2>Trips</h2>
          <p>Itinerary planning - pick customers to auto-generate a site-visit trip with map, shareable with anyone</p>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './components/Login'
import Calendar from './components/Calendar'
import Dashboard from './components/Dashboard'
import BidProjectList from './components/BidProjectList'
import BidStatistics from './components/BidStatistics'
import BidOpenPage from './components/BidOpenPage'
import BidTrackingBoard from './components/BidTrackingBoard'
import BidOpeningShare from './components/BidOpeningShare'
import LampLoginPreview from './components/LampLoginPreview'
import CustomerList from './components/CustomerList'
import CustomerDetail from './components/CustomerDetail'
import TripList from './components/TripList'
import VisitReportList from './components/VisitReportList'
import TripDetail from './components/TripDetail'
import TripShare from './components/TripShare'
import CustomerShare from './components/CustomerShare'
import CommandSearch from './components/CommandSearch'
import HotProjects from './components/HotProjects'

function App() {
  const { token } = useAuth()

  return (
    <Routes>
      <Route path="/preview/lamp-login" element={<LampLoginPreview />} />
      <Route path="/login" element={!token ? <Login /> : <Navigate to="/" />} />
      <Route path="/" element={token ? <Dashboard /> : <Navigate to="/login" />} />
      <Route path="/search" element={token ? <CommandSearch /> : <Navigate to="/login" />} />
      <Route path="/hotprojects" element={token ? <HotProjects /> : <Navigate to="/login" />} />
      <Route path="/calendar" element={token ? <Calendar /> : <Navigate to="/login" />} />
      <Route path="/chinabidding" element={token ? <BidProjectList /> : <Navigate to="/login" />} />
      <Route path="/chinabidding/stats" element={token ? <BidStatistics /> : <Navigate to="/login" />} />
      <Route path="/chinabidding/bidopen" element={token ? <BidOpenPage /> : <Navigate to="/login" />} />
      <Route path="/chinabidding/tracking" element={token ? <BidTrackingBoard /> : <Navigate to="/login" />} />
      <Route path="/customers" element={token ? <CustomerList /> : <Navigate to="/login" />} />
      <Route path="/customers/:id" element={token ? <CustomerDetail /> : <Navigate to="/login" />} />
      <Route path="/trips" element={token ? <TripList /> : <Navigate to="/login" />} />
      <Route path="/visit-reports" element={token ? <VisitReportList /> : <Navigate to="/login" />} />
      <Route path="/trips/:id" element={token ? <TripDetail /> : <Navigate to="/login" />} />
      {/* Public — no login required */}
      <Route path="/trip/share/:token" element={<TripShare />} />
      <Route path="/customers/share/:token" element={<CustomerShare />} />
      <Route path="/bidopen/share/:token" element={<BidOpeningShare />} />
    </Routes>
  )
}

export default App

import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './components/Login'
import Calendar from './components/Calendar'
import Dashboard from './components/Dashboard'
import BidProjectList from './components/BidProjectList'
import BidStatistics from './components/BidStatistics'
import LampLoginPreview from './components/LampLoginPreview'
import CustomerList from './components/CustomerList'
import CustomerDetail from './components/CustomerDetail'

function App() {
  const { token } = useAuth()

  return (
    <Routes>
      <Route path="/preview/lamp-login" element={<LampLoginPreview />} />
      <Route path="/login" element={!token ? <Login /> : <Navigate to="/" />} />
      <Route path="/" element={token ? <Dashboard /> : <Navigate to="/login" />} />
      <Route path="/calendar" element={token ? <Calendar /> : <Navigate to="/login" />} />
      <Route path="/chinabidding" element={token ? <BidProjectList /> : <Navigate to="/login" />} />
      <Route path="/chinabidding/stats" element={token ? <BidStatistics /> : <Navigate to="/login" />} />
      <Route path="/customers" element={token ? <CustomerList /> : <Navigate to="/login" />} />
      <Route path="/customers/:id" element={token ? <CustomerDetail /> : <Navigate to="/login" />} />
    </Routes>
  )
}

export default App

import { useLocation, useNavigate } from 'react-router-dom'
import { getPreviousAppPath, performBack, resolveBackTarget } from '../utils/appBack.js'

export default function useAppBack(fallbackPath, fallbackLabel, lang) {
  const location = useLocation()
  const navigate = useNavigate()
  const historyLength = typeof window !== 'undefined' ? window.history.length : 0
  const back = resolveBackTarget({
    search: location.search,
    state: location.state,
    fallbackPath,
    fallbackLabel,
    lang,
    previousPath: getPreviousAppPath(),
    historyLength,
  })
  const go = () => performBack(navigate, back, historyLength)
  return { ...back, go }
}

import { useMemo, useState } from 'react'

function WireMarks() {
  return (
    <div className="lamp-login__wiremarks" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

export default function LampLoginPreview() {
  const [isLightOn, setIsLightOn] = useState(true)
  const [isPulling, setIsPulling] = useState(false)

  const sceneClassName = useMemo(
    () => [
      'lamp-login',
      isLightOn ? 'lamp-login--on' : 'lamp-login--off',
      isPulling ? 'lamp-login--pulling' : '',
    ].filter(Boolean).join(' '),
    [isLightOn, isPulling],
  )

  function handlePull() {
    setIsPulling(true)
    window.setTimeout(() => {
      setIsLightOn((value) => !value)
      setIsPulling(false)
    }, 180)
  }

  return (
    <main className={sceneClassName}>
      <div className="lamp-login__ambient" aria-hidden="true" />
      <div className="lamp-login__grid" aria-hidden="true" />

      <section className="lamp-login__hero">
        <div className="lamp-login__lamp">
          <div className="lamp-login__lampcap" />
          <div className="lamp-login__lampglow" />
          <button
            type="button"
            className="lamp-login__cord"
            onMouseDown={() => setIsPulling(true)}
            onMouseUp={handlePull}
            onMouseLeave={() => setIsPulling(false)}
            onTouchStart={() => setIsPulling(true)}
            onTouchEnd={handlePull}
            aria-label={isLightOn ? 'Turn lamp off' : 'Turn lamp on'}
          >
            <span className="lamp-login__cordline" />
            <span className="lamp-login__cordhandle" />
          </button>
        </div>

        <div className="lamp-login__copy">
          <p className="lamp-login__eyebrow">Interactive Preview</p>
          <h1 className="lamp-login__title">Pull-to-light login concept</h1>
          <p className="lamp-login__text">
            Click or pull the lamp cord to switch the scene. This preview is isolated from the production login page.
          </p>
        </div>
      </section>

      <section className="lamp-login__panel">
        <div className="lamp-login__panelheader">
          <div>
            <p className="lamp-login__paneltag">HRC x WASI</p>
            <h2>Account access</h2>
          </div>
          <WireMarks />
        </div>

        <form className="lamp-login__form">
          <label className="lamp-login__field">
            <span>Username</span>
            <input type="text" placeholder="administrator" />
          </label>
          <label className="lamp-login__field">
            <span>Password</span>
            <input type="password" placeholder="••••••••" />
          </label>
          <div className="lamp-login__actions">
            <button type="button" className="lamp-login__primary">Sign in</button>
            <button type="button" className="lamp-login__secondary">
              {isLightOn ? 'Lights on' : 'Lights off'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

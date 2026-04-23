import { useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import './App.css'

const SHIFT_SECONDS = 36000

const PROCESS_FLOWS = {
  brushed: [
    'Press & Trim',
    'Washer',
    'Outside Grind/Polish',
    'Inside Finishing',
    'Bottom Finishing',
    'Handles',
    'Laser Engraving',
  ],
  titanium: [
    'Press & Trim',
    'Washer',
    'Outside Grind/Polish',
    'Polishing',
    'Washer (Post-Polish)',
    'Inside Finishing',
    'Bottom Finishing',
    'Handles',
    'Laser Engraving',
  ],
}
const ALL_PROCESSES = [
  'Press & Trim',
  'Washer',
  'Outside Grind/Polish',
  'Polishing',
  'Washer (Post-Polish)',
  'Inside Finishing',
  'Bottom Finishing',
  'Handles',
  'Laser Engraving',
]

const SERIES_LABELS = {
  brushed: 'Brushed',
  titanium: 'Titanium',
}

const SKU_TO_CANONICAL = {
  '25-14912-63': '12" Fry Pan Titanium',
  '25-14910-63': '10.5" Fry Pan Titanium',
  '25-14908-63': '8.5" Fry Pan Titanium',
  '25-14335-63': '12 Qt Stock Pot Titanium',
  '25-14319-63': '13.5" French Skillet Titanium',
  '25-14318-63': '13.5" Paella Pan Titanium',
  '25-14350-63': '13.5" Wok Titanium',
  '25-14402-63': '2.5 Qt Sauteuse Titanium',
  '25-14302-63': '2 Qt Sauce Titanium',
  '25-14305-63': '2 Qt Saucier Titanium',
  '25-14303-63': '3 Qt Sauce Titanium',
  '25-14309-63': '3 Qt Saucier Titanium',
  '25-14404L-63': '4 Qt Saucepan Titanium',
  '25-14404-63': '4 Qt Saucepot Titanium',
  '25-10411-63': '4 Qt Saute Titanium',
  '25-14304-63': '4 Qt Sauteuse Titanium',
  '25-14405-63': '5 Qt Saucepot Titanium',
  '25-14341-63': '5 Qt Saute Titanium',
  '25-14340-63': '5 Qt Sauteuse Titanium',
  '25-14306-63': '6 Qt Rondeau Titanium',
  '25-14358-63': '8 Qt Family Saute Titanium',
  '25-14346-63': '8 Qt Rondeau Titanium',
  '25-14308-63': '8 Qt Stock Pot Titanium',
  '25-14301-63': '1.5 Qt Saute Titanium',
  '25-14912E-63': '12" Fry Pan Brushed',
  '25-14910E-63': '10.5" Fry Pan Brushed',
  '25-14908E-63': '8.5" Fry Pan Brushed',
  '25-14301E-63': '1.5 Qt Saute Brushed',
  '25-14302E-63': '2 Qt Sauce Brushed',
  '25-14305E-63': '2 Qt Saucier Brushed',
  '25-14303E-63': '3 Qt Sauce Brushed',
  '25-14309E-63': '3 Qt Saucier Brushed',
  '25-14404E-63': '4 Qt Saucepan Brushed',
  '25-10411E-63': '4 Qt Saute Brushed',
  '25-14405E-63': '5 Qt Saucepot Brushed',
  '25-14306E-63': '6 Qt Rondeau Brushed',
  '25-14308E-63': '8 Qt Stock Pot Brushed',
}

const PRODUCT_CATALOG = Object.entries(SKU_TO_CANONICAL).map(([sku, name]) => ({
  sku,
  name,
  series: name.endsWith('Brushed') ? 'brushed' : 'titanium',
}))

function createCycleTimes() {
  return ALL_PROCESSES.reduce((accumulator, process, index) => {
    accumulator[process] = String(20 + index * 4)
    return accumulator
  }, {})
}

function formatSecondsToHMS(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function runSimulation(series, cycleTimes, product) {
  const processes = PROCESS_FLOWS[series]
  const normalized = processes.map((process) => ({
    process,
    cycleTime: Number(cycleTimes[process]),
  }))
  const bottleneck = normalized.reduce((slowest, current) =>
    current.cycleTime > slowest.cycleTime ? current : slowest,
  )
  const maxUnitsPerShiftRaw = SHIFT_SECONDS / bottleneck.cycleTime
  const maxUnitsPerShiftRoundedDown = Math.floor(maxUnitsPerShiftRaw)

  const processResults = normalized.map((item, index) => {
    const throughput = SHIFT_SECONDS / item.cycleTime
    const requiredRuntimeSeconds = maxUnitsPerShiftRaw * item.cycleTime
    const downstream = normalized[index + 1]
    let bufferUnitsEstimate = 0
    let bufferReason = 'No downstream process'

    if (downstream) {
      const upstreamRate = 1 / item.cycleTime
      const downstreamRate = 1 / downstream.cycleTime
      const differencePerSecond = upstreamRate - downstreamRate
      if (differencePerSecond > 0) {
        bufferUnitsEstimate = Math.ceil(differencePerSecond * SHIFT_SECONDS)
        bufferReason = `Upstream is faster than ${downstream.process}`
      } else {
        bufferReason = `Balanced or slower than ${downstream.process}`
      }
    }

    return {
      ...item,
      throughput,
      requiredRuntimeSeconds,
      requiredRuntimeHms: formatSecondsToHMS(requiredRuntimeSeconds),
      bufferUnitsEstimate,
      bufferRecommended: bufferUnitsEstimate > 0,
      bufferReason,
      downstreamProcess: downstream?.process ?? '-',
    }
  })

  return {
    series,
    productName: product.name,
    sku: product.sku,
    bottleneckProcess: bottleneck.process,
    bottleneckCycleTime: bottleneck.cycleTime,
    maxUnitsPerShiftRaw,
    maxUnitsPerShiftRoundedDown,
    processResults,
  }
}

function App() {
  const [series, setSeries] = useState('brushed')
  const [cycleTimes, setCycleTimes] = useState(() => createCycleTimes())
  const [errors, setErrors] = useState({})
  const [results, setResults] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [compareLeft, setCompareLeft] = useState('')
  const [compareRight, setCompareRight] = useState('')
  const resultsRef = useRef(null)

  const processList = useMemo(() => PROCESS_FLOWS[series], [series])
  const productsForSeries = useMemo(
    () => PRODUCT_CATALOG.filter((product) => product.series === series),
    [series],
  )
  const [selectedSku, setSelectedSku] = useState(
    PRODUCT_CATALOG.find((product) => product.series === 'brushed')?.sku ?? '',
  )
  const selectedProduct = useMemo(
    () => productsForSeries.find((product) => product.sku === selectedSku) ?? productsForSeries[0],
    [productsForSeries, selectedSku],
  )

  const validate = () => {
    const nextErrors = {}
    processList.forEach((process) => {
      const value = Number(cycleTimes[process])
      if (!cycleTimes[process] || Number.isNaN(value) || value <= 0) {
        nextErrors[process] = 'Enter a number greater than 0'
      }
    })
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSeriesChange = (event) => {
    const nextSeries = event.target.value
    const defaultSku = PRODUCT_CATALOG.find((product) => product.series === nextSeries)?.sku ?? ''
    setSeries(nextSeries)
    setSelectedSku(defaultSku)
    setCycleTimes((previous) => ({ ...createCycleTimes(), ...previous }))
    setErrors({})
    setResults(null)
  }

  const handleCycleTimeChange = (process, value) => {
    setCycleTimes((previous) => ({ ...previous, [process]: value }))
    setErrors((previous) => ({ ...previous, [process]: '' }))
  }

  const handleRunSimulation = () => {
    if (!validate()) return
    if (!selectedProduct) return
    setResults(runSimulation(series, cycleTimes, selectedProduct))
  }

  const handleReset = () => {
    setCycleTimes(createCycleTimes())
    setErrors({})
    setResults(null)
  }

  const handleSaveScenario = () => {
    if (!validate()) return
    if (!selectedProduct) return
    const simulation = runSimulation(series, cycleTimes, selectedProduct)
    const name = selectedProduct.name
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const scenario = {
      id,
      name,
      series,
      sku: selectedProduct.sku,
      cycleTimes: { ...cycleTimes },
      results: simulation,
    }
    setScenarios((previous) => [...previous, scenario])
    if (!compareLeft) setCompareLeft(id)
    else if (!compareRight) setCompareRight(id)
  }

  const exportPdf = async () => {
    if (!resultsRef.current) return
    const canvas = await html2canvas(resultsRef.current, {
      scale: 2,
      backgroundColor: '#ffffff',
    })
    const imageData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width
    pdf.text('Cookware Cycle Time Simulation Report', 10, 10)
    pdf.addImage(imageData, 'PNG', 10, 16, pdfWidth - 20, pdfHeight - 6)
    pdf.save('cycle-time-simulation-report.pdf')
  }

  const leftScenario = scenarios.find((scenario) => scenario.id === compareLeft)
  const rightScenario = scenarios.find((scenario) => scenario.id === compareRight)

  return (
    <main className="page">
      <header className="card">
        <h1>Cookware Manufacturing Cycle Time Optimizer</h1>
        <p>Single-piece flow simulation for 10-hour shifts (36,000 seconds).</p>
      </header>

      <section className="card">
        <h2>1) Product and Cycle Times</h2>
        <div className="grid controls">
          <label className="field">
            <span>Product Series</span>
            <select value={series} onChange={handleSeriesChange}>
              {Object.entries(SERIES_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Product Name</span>
            <select
              value={selectedProduct?.sku ?? ''}
              onChange={(event) => setSelectedSku(event.target.value)}
            >
              {productsForSeries.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>SKU</span>
            <input type="text" value={selectedProduct?.sku ?? ''} readOnly />
          </label>
        </div>

        <div className="process-grid">
          {ALL_PROCESSES.map((process) => {
            const isActive = processList.includes(process)
            return (
            <label key={process} className="field">
              <span>{process} (seconds)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={cycleTimes[process] ?? ''}
                onChange={(event) => handleCycleTimeChange(process, event.target.value)}
                disabled={!isActive}
              />
              <small className={`status ${isActive ? 'active' : 'inactive'}`}>
                {isActive ? 'Used in selected series' : 'Not used for selected series'}
              </small>
              {isActive && errors[process] && <small className="error">{errors[process]}</small>}
            </label>
            )
          })}
        </div>

        <div className="actions">
          <button onClick={handleRunSimulation}>Run Simulation</button>
          <button className="secondary" onClick={handleReset}>
            Reset
          </button>
          <button className="secondary" onClick={handleSaveScenario}>
            Save Scenario
          </button>
          <button className="secondary" onClick={exportPdf} disabled={!results}>
            Export PDF
          </button>
        </div>
      </section>

      {results && (
        <section className="card" ref={resultsRef}>
          <h2>2) Simulation Results</h2>
          <div className="kpis">
            <div className="kpi">
              <p className="label">Product Details</p>
              <p className="value">{results.productName}</p>
              <p className="note">SKU: {results.sku}</p>
              <p className="note">Series: {SERIES_LABELS[results.series]}</p>
            </div>
            <div className="kpi">
              <p className="label">Bottleneck Process</p>
              <p className="value">{results.bottleneckProcess}</p>
            </div>
            <div className="kpi">
              <p className="label">Max Units per Shift</p>
              <p className="value">{results.maxUnitsPerShiftRoundedDown} units</p>
              <p className="note">Rounded down from {results.maxUnitsPerShiftRaw.toFixed(2)}</p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Process</th>
                  <th>Cycle Time (s)</th>
                  <th>Throughput (units/shift)</th>
                  <th>Required Runtime (s)</th>
                  <th>Required Runtime (hh:mm:ss)</th>
                  <th>Buffer Recommendation</th>
                  <th>Est. Buffer Units</th>
                </tr>
              </thead>
              <tbody>
                {results.processResults.map((row) => (
                  <tr key={row.process}>
                    <td>{row.process}</td>
                    <td>{row.cycleTime.toFixed(2)}</td>
                    <td>{Math.floor(row.throughput)}</td>
                    <td>{Math.round(row.requiredRuntimeSeconds)}</td>
                    <td>{row.requiredRuntimeHms}</td>
                    <td>{row.bufferRecommended ? 'Yes' : 'No'}</td>
                    <td>
                      {row.bufferRecommended
                        ? `${row.bufferUnitsEstimate} (${row.bufferReason})`
                        : `0 (${row.bufferReason})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h2>3) Compare Scenarios (2 at a time)</h2>
        {scenarios.length === 0 ? (
          <p>Save at least two scenarios to compare.</p>
        ) : (
          <>
            <div className="grid controls">
              <label className="field">
                <span>Left Scenario</span>
                <select value={compareLeft} onChange={(event) => setCompareLeft(event.target.value)}>
                  <option value="">Select</option>
                  {scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Right Scenario</span>
                <select value={compareRight} onChange={(event) => setCompareRight(event.target.value)}>
                  <option value="">Select</option>
                  {scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {leftScenario && rightScenario && (
              <div className="comparison">
                {[leftScenario, rightScenario].map((scenario) => (
                  <article key={scenario.id} className="compare-card">
                    <h3>{scenario.name}</h3>
                    <p>SKU: {scenario.sku}</p>
                    <p>{SERIES_LABELS[scenario.series]}</p>
                    <p>
                      Bottleneck: <strong>{scenario.results.bottleneckProcess}</strong>
                    </p>
                    <p>
                      Max units: <strong>{scenario.results.maxUnitsPerShiftRoundedDown}</strong> (rounded
                      down)
                    </p>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}

export default App

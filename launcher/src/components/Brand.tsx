// Brand marks: the blocky VT icon and the stacked blocky lockup (VANILLA TURKEY + CLIENT).
export function VtSymbol({ size = 24, className = '' }: { size?: number; className?: string }) {
  return <img className={'vt-symbol ' + className} src="./vt_block.png" height={size} style={{ height: size, width: 'auto', objectFit: 'contain' }} alt="" aria-hidden="true" draggable={false} />
}

export function Lockup({ scale = 1, client = true }: { scale?: number; client?: boolean }) {
  return (
    <div className="vt-lockup" role="img" aria-label="VanillaTurkey Client">
      <img className="vt-word" src="./logo_block.png" style={{ width: Math.round(440 * scale) }} alt="" draggable={false} />
      {client && <img className="vt-sub" src="./client_block.png" style={{ width: Math.round(200 * scale) }} alt="" draggable={false} />}
    </div>
  )
}

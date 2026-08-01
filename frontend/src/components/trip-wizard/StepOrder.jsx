import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { hasCoords, orderByNearestNeighbour } from '../../utils/trips'
import { Badge, Button, Card, Input, Select } from '../ui'

function SortableStop({ stop, customer, index, total, onMove, onField }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.customerId })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex gap-2 rounded-2xl border bg-white p-3 sm:gap-3 ${
        isDragging ? 'z-10 border-brand-400 shadow-card-hover' : 'border-slate-200 shadow-card'
      }`}
    >
      {/* The drag listeners go on this handle alone. Binding them to the whole
          row would swallow taps meant for the priority select and the text
          inputs inside it. touch-none stops iOS treating a long press as a
          text-selection gesture and popping the magnifier. */}
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Reorder ${customer?.name}, currently ${index + 1} of ${total}`}
        className="touch-none cursor-grab select-none self-stretch rounded-lg px-1.5 text-lg leading-none text-slate-300 transition hover:bg-slate-50 hover:text-slate-500 active:cursor-grabbing"
      >
        ⠿
      </button>

      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold tabular-nums text-white">
        {index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 truncate font-semibold text-slate-800">{customer?.name}</p>
          {!hasCoords(customer) && <Badge tone="amber">no coords</Badge>}
        </div>
        {customer?.address && <p className="truncate text-xs text-slate-400">{customer.address}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            value={stop.priority || 'NORMAL'}
            onChange={(e) => onField('priority', e.target.value)}
            className="w-auto py-1 text-xs"
            aria-label="Priority"
          >
            <option value="PRIORITY">Priority</option>
            <option value="NORMAL">Normal</option>
            <option value="BACKUP">Backup</option>
          </Select>
          <Input
            value={stop.visitDuration || ''}
            onChange={(e) => onField('visitDuration', e.target.value)}
            placeholder="1 day"
            className="w-24 py-1 text-xs"
            aria-label="Visit duration"
          />
        </div>
        <Input
          value={stop.notes || ''}
          onChange={(e) => onField('notes', e.target.value)}
          placeholder="Notes for the planner…"
          className="mt-1.5 py-1 text-xs"
          aria-label="Stop notes"
        />
      </div>

      {/* Keyboard and no-pointer fallback. dnd-kit's KeyboardSensor covers
          desktop, but these also cover "drag didn't work on my phone" — do not
          remove them. */}
      <div className="flex shrink-0 flex-col justify-center gap-1">
        <Button size="sm" variant="secondary" aria-label="Move up" disabled={index === 0} onClick={() => onMove(index, -1)}>▲</Button>
        <Button size="sm" variant="secondary" aria-label="Move down" disabled={index === total - 1} onClick={() => onMove(index, 1)}>▼</Button>
      </div>
    </li>
  )
}

export default function StepOrder({ draft, patch, customers }) {
  const customerById = new Map(customers.map((c) => [c.id, c]))
  const ids = draft.stops.map((s) => s.customerId)
  const nameOf = (id) => customerById.get(id)?.name || 'stop'

  const sensors = useSensors(
    // 6px of slop: a tap on the select / inputs inside a row must not be read
    // as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Press-and-hold to drag on touch. Any shorter and a vertical swipe gets
    // captured as a drag, which makes the page impossible to scroll on a phone;
    // the tolerance lets a slightly shaky finger still count as a press.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reorder = (from, to) => patch((d) => ({ ...d, stops: arrayMove(d.stops, from, to) }))

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    reorder(ids.indexOf(active.id), ids.indexOf(over.id))
  }

  const onMove = (i, dir) => {
    const j = i + dir
    if (j >= 0 && j < draft.stops.length) reorder(i, j)
  }

  const setField = (customerId, field, value) =>
    patch((d) => ({
      ...d,
      stops: d.stops.map((s) => (s.customerId === customerId ? { ...s, [field]: value } : s)),
    }))

  const suggestGeographic = () =>
    patch((d) => {
      const ordered = orderByNearestNeighbour(d.stops.map((s) => ({ ...s, ...customerById.get(s.customerId) })))
      // Map back to draft stops by customerId — the merged objects above carry
      // customer fields we must not persist into the draft.
      const byId = new Map(d.stops.map((s) => [s.customerId, s]))
      return { ...d, stops: ordered.map((o) => byId.get(o.customerId)).filter(Boolean) }
    })

  const announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} is over position ${ids.indexOf(over.id) + 1}` : '',
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)} dropped at position ${ids.indexOf(over.id) + 1} of ${ids.length}` : 'Reorder cancelled',
    onDragCancel: ({ active }) => `Reorder of ${nameOf(active.id)} cancelled`,
  }

  const locatable = draft.stops.filter((s) => hasCoords(customerById.get(s.customerId))).length

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-2 p-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-700">Visit order</h2>
          <p className="text-xs text-slate-400">
            Drag the handle, or use ▲▼. This order is what the planner sees — it decides which
            customers get grouped together.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={suggestGeographic}
          disabled={locatable <= 2}
          title={locatable <= 2 ? 'Needs at least 3 stops with coordinates' : 'Reorder into a short route'}
        >
          Suggest geographic order
        </Button>
      </Card>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2.5">
            {draft.stops.map((s, i) => (
              <SortableStop
                key={s.customerId}
                stop={s}
                customer={customerById.get(s.customerId)}
                index={i}
                total={draft.stops.length}
                onMove={onMove}
                onField={(field, value) => setField(s.customerId, field, value)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {draft.stops.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-400">
          Go back to step 1 and pick at least one customer.
        </p>
      )}
    </div>
  )
}

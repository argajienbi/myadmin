/**
 * RadiusMapPicker — port dari komponen yang sama di myadmin lama.
 * Peta OpenStreetMap: marker tengah bisa digeser, gagang radius di tepi
 * lingkaran bisa digeser, plus input lat/lon/radius dan slider 10–2000 m.
 * Default: Jakarta (-6.18142435142701, 106.82099076217408), radius 300 m.
 */
import { useMemo, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  useMapEvents,
} from "react-leaflet"
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png"
import markerIcon from "leaflet/dist/images/marker-icon.png"
import markerShadow from "leaflet/dist/images/marker-shadow.png"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

export interface RadiusValue {
  latitude: number
  longitude: number
  radius_meter: number
}

const DEFAULT_VALUE: RadiusValue = {
  latitude: -6.18142435142701,
  longitude: 106.82099076217408,
  radius_meter: 300,
}

function MapClickHandler({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void
}) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function RadiusMapPicker({
  value,
  onChange,
  height = 320,
}: {
  value: RadiusValue
  onChange: (next: RadiusValue) => void
  height?: number
}) {
  const center = useMemo<RadiusValue>(
    () => ({
      latitude: Number.isFinite(value.latitude)
        ? value.latitude
        : DEFAULT_VALUE.latitude,
      longitude: Number.isFinite(value.longitude)
        ? value.longitude
        : DEFAULT_VALUE.longitude,
      radius_meter:
        Number.isFinite(value.radius_meter) && value.radius_meter > 0
          ? value.radius_meter
          : DEFAULT_VALUE.radius_meter,
    }),
    [value],
  )
  const markerRef = useRef<L.Marker | null>(null)
  const handleRef = useRef<L.Marker | null>(null)
  const [draft, setDraft] = useState({
    latitude: String(center.latitude),
    longitude: String(center.longitude),
    radius: String(center.radius_meter),
  })

  const centerLatLng = useMemo(
    () => L.latLng(center.latitude, center.longitude),
    [center],
  )
  // Gagang radius: titik di tepi lingkaran (arah timur dari pusat).
  const handleLatLng = useMemo(() => {
    const earthRadius = 6378137
    const dLng =
      (center.radius_meter / (earthRadius * Math.cos((center.latitude * Math.PI) / 180))) *
      (180 / Math.PI)
    return L.latLng(center.latitude, center.longitude + dLng)
  }, [center])

  const applyDraft = (next: Partial<typeof draft>) => {
    const merged = { ...draft, ...next }
    setDraft(merged)
    const latitude = Number(merged.latitude)
    const longitude = Number(merged.longitude)
    const radius = Number(merged.radius)
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      onChange({
        latitude,
        longitude,
        radius_meter:
          Number.isFinite(radius) && radius >= 10 && radius <= 2000
            ? radius
            : center.radius_meter,
      })
    }
  }

  return (
    <div className="grid gap-3">
      <div
        className="overflow-hidden rounded-lg border"
        style={{ height }}
      >
        <MapContainer
          center={centerLatLng}
          zoom={16}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler
            onPick={(lat, lng) => {
              onChange({ ...center, latitude: lat, longitude: lng })
              setDraft({
                latitude: String(lat),
                longitude: String(lng),
                radius: String(center.radius_meter),
              })
            }}
          />
          <Circle
            center={centerLatLng}
            radius={center.radius_meter}
            pathOptions={{ color: "#0b7a8c", fillOpacity: 0.15 }}
          />
          <Marker
            position={centerLatLng}
            draggable
            ref={markerRef}
            eventHandlers={{
              dragend() {
                const marker = markerRef.current
                if (!marker) return
                const pos = marker.getLatLng()
                onChange({
                  ...center,
                  latitude: pos.lat,
                  longitude: pos.lng,
                })
                setDraft({
                  latitude: String(pos.lat),
                  longitude: String(pos.lng),
                  radius: String(center.radius_meter),
                })
              },
            }}
          />
          <Marker
            position={handleLatLng}
            draggable
            ref={handleRef}
            eventHandlers={{
              dragend() {
                const marker = handleRef.current
                if (!marker) return
                const pos = marker.getLatLng()
                const distance = L.latLng(
                  center.latitude,
                  center.longitude,
                ).distanceTo(pos)
                const radius = Math.max(
                  10,
                  Math.min(2000, Math.round(distance)),
                )
                onChange({ ...center, radius_meter: radius })
                setDraft((d) => ({ ...d, radius: String(radius) }))
              },
            }}
          />
        </MapContainer>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="rmp-lat">Latitude</Label>
          <Input
            id="rmp-lat"
            inputMode="decimal"
            value={draft.latitude}
            onChange={(e) => applyDraft({ latitude: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rmp-lng">Longitude</Label>
          <Input
            id="rmp-lng"
            inputMode="decimal"
            value={draft.longitude}
            onChange={(e) => applyDraft({ longitude: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rmp-radius">Radius (meter)</Label>
          <Input
            id="rmp-radius"
            type="number"
            min={10}
            max={2000}
            value={draft.radius}
            onChange={(e) => applyDraft({ radius: e.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rmp-slider">Radius: {center.radius_meter} m</Label>
        <input
          id="rmp-slider"
          type="range"
          min={10}
          max={2000}
          step={10}
          value={center.radius_meter}
          onChange={(e) => {
            const radius = Number(e.target.value)
            onChange({ ...center, radius_meter: radius })
            setDraft((d) => ({ ...d, radius: String(radius) }))
          }}
          className="w-full accent-teal-700"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Klik peta atau geser marker untuk memindahkan pusat; geser marker di
        tepi lingkaran untuk mengubah radius.
      </p>
    </div>
  )
}

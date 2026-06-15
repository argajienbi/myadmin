import React, { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

export type RadiusMapValue = {
  latitude: number;
  longitude: number;
  radius_meter: number;
};

type RadiusMapPickerProps = {
  value: RadiusMapValue;
  onChange: (value: RadiusMapValue) => void;
  height?: number;
};

const DEFAULT_VALUE: RadiusMapValue = {
  latitude: -6.18142435142701,
  longitude: 106.82099076217408,
  radius_meter: 300,
};

const centerIcon = L.divIcon({
  className: "radius-picker-center-icon",
  html: '<div class="radius-picker-center-dot"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const radiusIcon = L.divIcon({
  className: "radius-picker-handle-icon",
  html: '<div class="radius-picker-handle-dot"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function toDeg(value: number) {
  return (value * 180) / Math.PI;
}

function getDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPointEastOfCenter(value: RadiusMapValue) {
  const lat = value.latitude;
  const lon = value.longitude;
  const radius = Math.max(10, value.radius_meter || DEFAULT_VALUE.radius_meter);

  const earthRadius = 6371000;
  const bearing = toRad(90);
  const angularDistance = radius / earthRadius;

  const lat1 = toRad(lat);
  const lon1 = toRad(lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: toDeg(lat2),
    lng: toDeg(lon2),
  };
}

function normalizeValue(value: RadiusMapValue): RadiusMapValue {
  const latitude =
    Number.isFinite(value.latitude) && value.latitude !== 0
      ? value.latitude
      : DEFAULT_VALUE.latitude;

  const longitude =
    Number.isFinite(value.longitude) && value.longitude !== 0
      ? value.longitude
      : DEFAULT_VALUE.longitude;

  const radius_meter =
    Number.isFinite(value.radius_meter) && value.radius_meter > 0
      ? Math.round(value.radius_meter)
      : DEFAULT_VALUE.radius_meter;

  return {
    latitude,
    longitude,
    radius_meter,
  };
}

function MapSync({ value }: { value: RadiusMapValue }) {
  const map = useMap();

  useEffect(() => {
    map.setView([value.latitude, value.longitude], map.getZoom(), {
      animate: true,
    });
  }, [map, value.latitude, value.longitude]);

  return null;
}

function MapClickHandler({
  value,
  onChange,
}: {
  value: RadiusMapValue;
  onChange: (value: RadiusMapValue) => void;
}) {
  useMapEvents({
    click(event) {
      onChange({
        ...value,
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      });
    },
  });

  return null;
}

export const RadiusMapPicker: React.FC<RadiusMapPickerProps> = ({
  value,
  onChange,
  height = 360,
}) => {
  const normalized = normalizeValue(value);

  const center = useMemo<[number, number]>(
    () => [normalized.latitude, normalized.longitude],
    [normalized.latitude, normalized.longitude]
  );

  const radiusHandle = useMemo(
    () => getPointEastOfCenter(normalized),
    [normalized.latitude, normalized.longitude, normalized.radius_meter]
  );

  const updateValue = (next: Partial<RadiusMapValue>) => {
    onChange(
      normalizeValue({
        ...normalized,
        ...next,
      })
    );
  };

  return (
    <div className="radius-picker">
      <div className="radius-picker-map" style={{ height }}>
        <MapContainer
          center={center}
          zoom={17}
          scrollWheelZoom
          className="radius-picker-leaflet"
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapSync value={normalized} />
          <MapClickHandler value={normalized} onChange={onChange} />

          <Circle
            center={center}
            radius={normalized.radius_meter}
            pathOptions={{
              color: "#009688",
              fillColor: "#009688",
              fillOpacity: 0.16,
              weight: 2,
            }}
          />

          <Marker
            position={center}
            icon={centerIcon}
            draggable
            eventHandlers={{
              dragend(event) {
                const marker = event.target as L.Marker;
                const latLng = marker.getLatLng();

                updateValue({
                  latitude: latLng.lat,
                  longitude: latLng.lng,
                });
              },
            }}
          />

          <Marker
            position={[radiusHandle.lat, radiusHandle.lng]}
            icon={radiusIcon}
            draggable
            eventHandlers={{
              drag(event) {
                const marker = event.target as L.Marker;
                const latLng = marker.getLatLng();

                const nextRadius = getDistanceMeters(
                  normalized.latitude,
                  normalized.longitude,
                  latLng.lat,
                  latLng.lng
                );

                updateValue({
                  radius_meter: Math.max(10, Math.round(nextRadius)),
                });
              },
              dragend(event) {
                const marker = event.target as L.Marker;
                const latLng = marker.getLatLng();

                const nextRadius = getDistanceMeters(
                  normalized.latitude,
                  normalized.longitude,
                  latLng.lat,
                  latLng.lng
                );

                updateValue({
                  radius_meter: Math.max(10, Math.round(nextRadius)),
                });
              },
            }}
          />
        </MapContainer>
      </div>

      <div className="radius-picker-controls">
        <div className="radius-picker-field">
          <label>Latitude</label>
          <input
            type="number"
            step="any"
            value={normalized.latitude}
            onChange={(event) =>
              updateValue({ latitude: Number(event.target.value) })
            }
          />
        </div>

        <div className="radius-picker-field">
          <label>Longitude</label>
          <input
            type="number"
            step="any"
            value={normalized.longitude}
            onChange={(event) =>
              updateValue({ longitude: Number(event.target.value) })
            }
          />
        </div>

        <div className="radius-picker-field">
          <label>Radius Meter</label>
          <input
            type="number"
            min={10}
            step={1}
            value={normalized.radius_meter}
            onChange={(event) =>
              updateValue({ radius_meter: Number(event.target.value) })
            }
          />
        </div>
      </div>

      <div className="radius-picker-slider">
        <label>
          Geser radius: <b>{normalized.radius_meter} meter</b>
        </label>
        <input
          type="range"
          min={10}
          max={2000}
          step={10}
          value={normalized.radius_meter}
          onChange={(event) =>
            updateValue({ radius_meter: Number(event.target.value) })
          }
        />
      </div>

      <p className="radius-picker-help">
        Klik map untuk memindahkan titik kantor. Geser titik tengah untuk
        memindahkan lokasi. Geser handle di tepi lingkaran untuk menentukan
        radius. Field ini akan disimpan ke RTDB sebagai latitude, longitude, dan
        radius_meter.
      </p>
    </div>
  );
};

import { ref, computed, readonly } from 'vue';
import { useRuntimeConfig } from '#app';
import { useUserStore } from '~/store/user'; // importa tu store
import type { Venue } from './useVenue'; // Asegúrate de que la ruta sea correcta

export interface Organizer {
  id: string;
  name: string;
  member_since: number;
  avatar_url: string;
}

export interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time?: string;
  location: string;
  address?: string;
  image_url: string;
  category?: string;
  attendees?: number;
  latitude?: number;
  longitude?: number;
  organizer?: Organizer;
  venue: Venue | null; // Asegúrate de que Venue esté importado correctamente
}

export interface PaginatedEvents {
  current_page: number;
  next_page_url: string | null;
  prev_page_url: string | null;
  path: string;
  per_page: number;
  total: number;
  to: number;
  data: Event[];
}

function mapApiEventToEvent(apiEvent: any): Event {
  const dateObj = new Date(apiEvent.date);
  const date = dateObj.toISOString().split('T')[0];
  const time = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  let location = '';
  if (apiEvent.venue?.name) {
    location = apiEvent.venue.name;
  } else if (apiEvent.latitude && apiEvent.longitude) {
    location = `Lat: ${apiEvent.latitude}, Lng: ${apiEvent.longitude}`;
  } else {
    location = 'Ubicación no disponible';
  }

  const address = apiEvent.venue?.address || '';

  let category = '';
  if (Array.isArray(apiEvent.hashtags)) {
    category = apiEvent.hashtags[0]?.replace(/^#/, '') || '';
  } else if (typeof apiEvent.hashtags === 'string') {
    category = apiEvent.hashtags.replace(/^#/, '').split(' ')[0];
  }

  const image_url = apiEvent.image_url || '';

  // ✅ Nuevo: mapear organizer si existe
  const organizer = apiEvent.organizer
    ? {
      id: apiEvent.organizer.id?.toString() || '',
      name: apiEvent.organizer.name || '',
      member_since: apiEvent.organizer.member_since || 0,
      avatar_url: apiEvent.organizer.avatar_url || '',
    }
    : undefined;

  return {
    id: apiEvent.id.toString(),
    title: apiEvent.name || 'Evento sin título',
    description: apiEvent.description || '',
    date,
    time,
    location,
    address,
    image_url,
    category,
    attendees: undefined,
    latitude: apiEvent.latitude || null,
    longitude: apiEvent.longitude || null,
    organizer,
    venue: apiEvent.venue || null
  };
}

export const fetchUserEvents = async () => {
  const events = ref<Event[]>([]);
  const isLoading = ref(false);
  const config = useRuntimeConfig();
  const userStore = useUserStore();
  const token = computed(() => userStore.token);
  isLoading.value = true;

  try {
    const res = await fetch(`${config.public.apiBaseUrl}/events/my-events`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token.value}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) throw new Error(`Error fetching user events: ${res.status}`);

    const json = await res.json();
    const apiEvents = json.data.data || json.data;

    // Opcional: podés usar un array separado si no querés mezclar con "todos"
    events.value = apiEvents.map(mapApiEventToEvent);
  } catch (error) {
    console.error('Error al obtener eventos del usuario:', error);
    events.value = [];
  }
  isLoading.value = false;
};

export const useEvents = () => {
  const events = ref<Event[]>([]);
  const paginatedEvents = ref<PaginatedEvents | null>(null);
  const searchQuery = ref('');
  const selectedLocation = ref('');
  const config = useRuntimeConfig();
  const isLoading = ref(false);

  const userStore = useUserStore(); // instancia del store
  const token = computed(() => userStore.token); // accede de forma reactiva
  const userPosition = ref<{ lat: number, lng: number } | null>(null);
  const useCurrentLocation = ref(false); // si el usuario elige esta opción
  const distanceThresholdKm = 20; // distancia máxima para considerar "cerca"

  const getUserLocation = () => {
    if (!navigator.geolocation) {
      console.warn('Geolocalización no soportada');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        userPosition.value = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
      },
      error => {
        console.error('Error al obtener ubicación:', error);
      }
    );
  };

  function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Radio de la tierra en km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  const fetchEventsFromApi = async () => {
    isLoading.value = true;
    try {
      const res = await fetch(`${config.public.apiBaseUrl}/events`);
      if (!res.ok) throw new Error('Error fetching events');

      const json = await res.json();
      const apiEvents = json.data.data;
      events.value = apiEvents.map(mapApiEventToEvent);
    } catch (error) {
      console.error('Error al obtener eventos:', error);
      events.value = [];
    }
    isLoading.value = false;
  };

  const fetchEventsFromApiPaginated = async (page: number, limit: number) => {
    isLoading.value = true;

    try {
      const res = await fetch(`${config.public.apiBaseUrl}/events?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error('Error fetching paginated events');

      const json = await res.json();

      json.data.data = json.data.data.map(mapApiEventToEvent);

      console.log('Eventos paginados obtenidos:', json.data);

      paginatedEvents.value = json.data;
      
    } catch (error) {
      console.error('Error al obtener eventos paginados:', error);
      events.value = [];
    }
    isLoading.value = false;
  };

  const createEvent = async (eventData: FormData | any) => {
    console.log('Token desde el store en create events:', token.value);
    try {
      const res = await fetch(`${config.public.apiBaseUrl}/events`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.value}`,
          'Accept': 'application/json'
        },

        body: eventData instanceof FormData ? eventData : JSON.stringify(eventData)
      });

      const text = await res.text();

      if (!res.ok) {
        console.error('Respuesta de error del servidor:', text);
        throw new Error(`Error creando evento: ${res.status} - ${text}`);
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch (parseError) {
        console.error('Error al parsear JSON:', parseError, '\nRespuesta recibida:', text);
        throw new Error('Respuesta del servidor no es un JSON válido');
      }

      if (json.data) {
        const newEvent = mapApiEventToEvent(json.data);
        events.value.push(newEvent);
      }

      return true;
    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  const filteredEvents = computed(() => {
    let filtered = events.value;

    // Filtro por texto
    if (searchQuery.value) {
      filtered = filtered.filter(event =>
        event.title.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        event.description.toLowerCase().includes(searchQuery.value.toLowerCase())
      );
    }

    // Filtro por ubicación seleccionada
    if (selectedLocation.value && !useCurrentLocation.value) {
      filtered = filtered.filter(event =>
        event.location.toLowerCase().includes(selectedLocation.value.toLowerCase())
      );
    }

    // Filtro por ubicación actual
    if (useCurrentLocation.value && userPosition.value) {
      filtered = filtered.filter(event => {
        if (event.latitude && event.longitude) {
          const dist = getDistanceKm(userPosition.value!.lat, userPosition.value!.lng, event.latitude, event.longitude);
          return dist <= distanceThresholdKm;
        }
        return false;
      });
    }

    return filtered;
  });


  const getEventById = async (id: string) => {
    const response = await fetch(`${config.public.apiBaseUrl}/events/${id}`, {
      method: 'GET',
    });

    const json = await response.json();

    const mappedEvent = mapApiEventToEvent(json.data);

    return mappedEvent;
  };

  return {
    events: readonly(events),
    paginatedEvents: readonly(paginatedEvents),
    fetchEventsFromApi,
    fetchEventsFromApiPaginated,
    filteredEvents,
    fetchUserEvents,
    searchQuery,
    selectedLocation,
    useCurrentLocation,
    getUserLocation,
    getEventById,
    createEvent,
    isLoading
  };

};

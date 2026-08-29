const FILES = [
  'overview.json',
  'activities.json',
  'sessions.json',
  'instructors.json',
  'courses.json',
  'feedback.json',
  'events.json',
  'diplomas.json',
  'forecast.json',
];

const data = {
  overview: null,
  activities: [],
  sessions: [],
  instructors: [],
  courses: [],
  feedback: [],
  events: [],
  diplomas: [],
  forecast: null,
};

const ready = Promise.all(
  FILES.map(async (file) => {
    const res = await fetch(`data/${file}`);
    if (!res.ok) throw new Error(`Failed to load ${file}`);
    const key = file.replace('.json', '');
    data[key] = await res.json();
  }),
).then(() => data);

export { data, ready };

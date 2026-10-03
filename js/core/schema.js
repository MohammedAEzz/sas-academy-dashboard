/**
 * Upload schemas. Template headers, validation, and example rows all come from here.
 * Dataset ids match the upload templates. `groups` rows are activities.json shaped.
 */

export const DATASET_IDS = ["instructors", "courses", "groups", "sessions", "feedback", "events"];

export const SATISFACTION_VALUES = [
  "Very satisfied",
  "Somewhat satisfied",
  "Neither satisfied nor dissatisfied",
  "Somewhat dissatisfied",
  "Very dissatisfied",
];

export const SATISFACTION_SCORES = {
  "very satisfied": 5,
  "somewhat satisfied": 4,
  "neither satisfied nor dissatisfied": 3,
  "somewhat dissatisfied": 2,
  "very dissatisfied": 1,
};

/** scripts/common.py FEEDBACK_QUESTION_RATING_MAP */
export const RATING_VALUES = ["Excellent", "Above average", "Average", "Below average", "Poor"];

export const RATING_SCORES = {
  excellent: 5,
  "above average": 4,
  average: 3,
  "below average": 2,
  poor: 1,
};

export const COURSE_CATEGORIES = [
  "Visual Analytics",
  "Statistical Analytics",
  "Advanced Analytics",
  "Data Science and Machine Learning",
];

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const GENERAL_INSTRUCTIONS = [
  "Upload one dataset per file. Do not rename, remove, or add columns.",
  "Keep this header row. Enter records starting on row 2. The header is row 1.",
  "CSV files must be saved as CSV UTF-8 so Arabic text stays intact. The example file includes a byte-order mark for Excel.",
  "Dates use YYYY-MM-DD. Times use 24-hour HH:MM.",
  "Instructor and course names must match an existing name (ignoring case, extra spaces, and titles such as Dr.). Upload new instructors or courses before groups, sessions, or feedback that use them.",
  "Group codes look like MBA-G281 or DBA-G12. A code with 4 or more digits is accepted only when that group already exists.",
  "Identical rows are skipped. A row that reuses a key with different details is reported as a conflict and is not imported. Nothing already stored is overwritten.",
  "Student comments are stored with email addresses and long numbers removed.",
];

function col(id, extras) {
  return {
    id,
    required: false,
    type: "text",
    format: "",
    units: "",
    values: null,
    description: "",
    ...extras,
  };
}

export const DATASETS = {
  instructors: {
    label: "Instructors",
    columns: [
      col("instructor_name", { required: true, description: "Name as it should appear on the dashboard, for example Ahmed Tealeb." }),
      col("title", { required: true, type: "enum", values: ["Dr.", "Eng."], description: "Professional title." }),
      col("status", { required: true, type: "enum", values: ["Active", "Not Active"], description: "Whether the instructor is currently active." }),
      col("full_name_ar", { description: "Optional full Arabic name." }),
      col("system_name_ar", { description: "Optional Arabic name used in source systems." }),
    ],
  },
  courses: {
    label: "Courses",
    columns: [
      col("course_name", { required: true, description: "Course name, for example Leading with Analytics." }),
      col("declared_hours", { type: "number", format: "Number greater than 0", units: "hours", description: "Optional planned duration of the course." }),
      col("course_category", { type: "enum", values: COURSE_CATEGORIES, description: "Optional skill category. Leave blank if unknown." }),
    ],
  },
  groups: {
    label: "Groups",
    storage: "activities",
    columns: [
      col("group_code", { required: true, format: "MBA-G281 or DBA-G12", description: "Offering group code. 1–3 digit numbers are always accepted. 4 or more digits must already exist." }),
      col("course_name", { required: true, description: "Must match an existing course name." }),
      col("instructor_name", { required: true, description: "Must match an existing instructor name." }),
      col("activity_type", { required: true, type: "enum", values: ["INTERNAL", "EXTERNAL"], description: "Internal academy group or external client group." }),
      col("degree", { required: true, type: "enum", values: ["MBA", "DBA"], description: "Programme degree." }),
      col("language", { required: true, type: "enum", values: ["Arabic", "English"], description: "Language of delivery." }),
      col("num_students", { type: "integer", format: "Whole number from 1 to 500", units: "students", description: "Optional class size." }),
      col("day", { type: "enum", values: WEEKDAYS, description: "Optional meeting day." }),
      col("status", { type: "enum", values: ["COMPLETED", "PLANNED", "UNKNOWN"], description: "Optional. Blank is stored as UNKNOWN." }),
    ],
  },
  sessions: {
    label: "Sessions",
    columns: [
      col("session_date", { required: true, type: "date", format: "YYYY-MM-DD", description: "Lecture date. Cannot be more than 2 years in the future." }),
      col("group_code", { format: "MBA-G281 or DBA-G12", description: "Required unless activity_type is DIPLOMA. Leave blank for diploma lectures." }),
      col("course_name", { required: true, description: "Must match an existing course name." }),
      col("instructor_name", { required: true, description: "Must match an existing instructor name." }),
      col("session_number", { required: true, type: "integer", format: "Whole number from 1 to 50", description: "Lecture number within the offering." }),
      col("duration_hours", { required: true, type: "number", format: "Number from 0.5 to 12", units: "hours", description: "Length of the lecture." }),
      col("language", { type: "enum", values: ["Arabic", "English"], description: "Optional language of this lecture." }),
      col("activity_type", { required: true, type: "enum", values: ["INTERNAL", "EXTERNAL", "DIPLOMA"], description: "Use DIPLOMA for diploma lectures, which also need diploma_type and no group code." }),
      col("start_time", { type: "time", format: "HH:MM (24-hour)", description: "Optional start time." }),
      col("status", { type: "enum", values: ["COMPLETED", "PLANNED", "UNKNOWN"], description: "Optional. Leave blank to store no status; the dashboard derives it from the date." }),
      col("diploma_type", { type: "enum", values: ["MBA", "DBA"], description: "Required when activity_type is DIPLOMA. Leave blank otherwise." }),
    ],
  },
  feedback: {
    label: "Feedback",
    columns: [
      col("response_id", { description: "Optional id from the survey tool. When present it is the identity of the response. When blank, identity is a fingerprint of the answers." }),
      col("feedback_date", { required: true, type: "date", format: "YYYY-MM-DD", description: "Date of the response." }),
      col("activity_type", { required: true, type: "enum", values: ["INTERNAL", "EXTERNAL"], description: "Internal or external delivery." }),
      col("group_code", { format: "MBA-G281 or DBA-G12", description: "Optional. A valid code is marked MAPPED. Anything else is stored as REVIEW and does not reject the row." }),
      col("course_name", { description: "Optional. When filled, it must match an existing course." }),
      col("instructor_names", { description: "Optional. Separate multiple instructors with a semicolon. Each name must match an existing instructor. One stored row is created per instructor." }),
      col("overall_satisfaction", { required: true, type: "enum", values: SATISFACTION_VALUES, description: "Overall satisfaction, using one of the listed phrases." }),
      col("rating_elearning", { type: "enum", values: RATING_VALUES, description: "Optional e-learning rating." }),
      col("rating_guided", { type: "enum", values: RATING_VALUES, description: "Optional guided-practice rating." }),
      col("rating_project", { type: "enum", values: RATING_VALUES, description: "Optional project rating." }),
      col("rating_knowledge", { type: "enum", values: RATING_VALUES, description: "Optional knowledge rating." }),
      col("rating_leadership", { type: "enum", values: RATING_VALUES, description: "Optional leadership rating." }),
      col("rating_soft_skills", { type: "enum", values: RATING_VALUES, description: "Optional soft-skills rating." }),
      col("recommendation_score", { type: "integer", format: "Whole number from 0 to 10", units: "score", description: "Optional likelihood to recommend. 9–10 promoter, 7–8 passive, 0–6 detractor." }),
      col("comment", { description: "Optional student comment. Email addresses and numbers of 9 or more digits are replaced with [REDACTED-PII]." }),
    ],
  },
  events: {
    label: "Events",
    columns: [
      col("event_name", { required: true, description: "Event name." }),
      col("event_type", { required: true, type: "enum", values: ["BOOTCAMP", "HACKATHON", "WORKSHOP", "OTHER"], description: "Event type. The programmes page prints this label." }),
      col("event_date_start", { required: true, type: "date", format: "YYYY-MM-DD", description: "First day of the event." }),
      col("event_date_end", { required: true, type: "date", format: "YYYY-MM-DD", description: "Last day of the event. Must be on or after the start date." }),
      col("participant_count", { required: true, type: "integer", format: "Whole number, 0 or more", units: "participants", description: "Recorded participants." }),
    ],
  },
};

export function datasetSchema(dataset) {
  const schema = DATASETS[dataset];
  if (!schema) return null;
  return schema;
}

export function columnIds(dataset) {
  return DATASETS[dataset].columns.map((column) => column.id);
}

export function requiredColumnIds(dataset) {
  return DATASETS[dataset].columns.filter((column) => column.required).map((column) => column.id);
}

const EXAMPLE_INSTRUCTOR = "Ahmed Tealeb";
const EXAMPLE_INSTRUCTOR_2 = "Osama Mobarez";
const EXAMPLE_COURSE = "Leading with Analytics";

export function exampleRows(dataset) {
  if (dataset === "instructors") {
    return [
      { instructor_name: "Layla Hassan", title: "Dr.", status: "Active", full_name_ar: "د. ليلى حسن", system_name_ar: "د. ليلى حسن" },
      { instructor_name: "Omar Farouk", title: "Eng.", status: "Not Active", full_name_ar: "", system_name_ar: "" },
      { instructor_name: "Nour El Din", title: "Dr.", status: "Active", full_name_ar: "", system_name_ar: "" },
    ];
  }
  if (dataset === "courses") {
    return [
      { course_name: "Upload Template Course Alpha", declared_hours: 12, course_category: "Visual Analytics" },
      { course_name: "Upload Template Course Beta", declared_hours: 8, course_category: "Statistical Analytics" },
      { course_name: "Upload Template Course Gamma", declared_hours: "", course_category: "" },
    ];
  }
  if (dataset === "groups") {
    return [990, 991, 992].map((code, index) => ({
      group_code: `MBA-G${code}`,
      course_name: EXAMPLE_COURSE,
      instructor_name: EXAMPLE_INSTRUCTOR,
      activity_type: index === 2 ? "EXTERNAL" : "INTERNAL",
      degree: "MBA",
      language: index === 1 ? "English" : "Arabic",
      num_students: 24 + index,
      day: "Sunday",
      status: "COMPLETED",
    }));
  }
  if (dataset === "sessions") {
    return [1, 2, 3].map((number) => ({
      session_date: `2026-11-0${number}`,
      group_code: "MBA-G990",
      course_name: EXAMPLE_COURSE,
      instructor_name: EXAMPLE_INSTRUCTOR,
      session_number: number,
      duration_hours: number === 3 ? 1.5 : 3,
      language: "Arabic",
      activity_type: "INTERNAL",
      start_time: "17:00",
      status: "PLANNED",
      diploma_type: "",
    }));
  }
  if (dataset === "feedback") {
    return [1, 2, 3].map((number) => ({
      response_id: "",
      feedback_date: `2026-11-1${number}`,
      activity_type: "INTERNAL",
      group_code: "MBA-G990",
      course_name: EXAMPLE_COURSE,
      instructor_names: number === 3 ? `${EXAMPLE_INSTRUCTOR}; ${EXAMPLE_INSTRUCTOR_2}` : EXAMPLE_INSTRUCTOR,
      overall_satisfaction: "Very satisfied",
      rating_elearning: "Excellent",
      rating_guided: "Above average",
      rating_project: "Average",
      rating_knowledge: "Excellent",
      rating_leadership: "Above average",
      rating_soft_skills: "Excellent",
      recommendation_score: 9,
      comment: `TEMPLATE-EXAMPLE-${number} عينة تعليق`,
    }));
  }
  return [
    { event_name: "Template Workshop Alpha", event_type: "WORKSHOP", event_date_start: "2026-11-01", event_date_end: "2026-11-02", participant_count: 20 },
    { event_name: "Template Bootcamp Beta", event_type: "BOOTCAMP", event_date_start: "2026-12-01", event_date_end: "2026-12-05", participant_count: 40 },
    { event_name: "Template Hackathon Gamma", event_type: "HACKATHON", event_date_start: "2026-12-12", event_date_end: "2026-12-12", participant_count: 0 },
  ];
}

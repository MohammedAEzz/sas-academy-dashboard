/**
 * Realistic rows for tests and browser checks. They are NOT the template examples: the importer
 * rejects exact example rows, so these differ from them in at least one identifying field.
 */
const EXAMPLE_INSTRUCTOR = "Ahmed Tealeb";
const EXAMPLE_INSTRUCTOR_2 = "Osama Mobarez";
const EXAMPLE_COURSE = "Leading with Analytics";

export function qaRows(dataset) {
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

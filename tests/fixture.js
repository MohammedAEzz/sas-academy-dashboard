export function fixtureBase() {
  const instructor = {
    instructor_id: "INS_001",
    instructor_name_clean: "Ahmed Tealeb",
    full_name_ar: "د. احمد تعيلب",
    system_name_ar: "",
    first_name_en: "",
    last_name_en: "",
    title: "Dr.",
    status: "Active",
  };
  const second = {
    instructor_id: "INS_003",
    instructor_name_clean: "Osama Mobarez",
    full_name_ar: "",
    system_name_ar: "",
    first_name_en: "",
    last_name_en: "",
    title: "Dr.",
    status: "Active",
  };
  const course = {
    course_id: "CRS_003",
    course_name_clean: "Leading with Analytics",
    declared_hours: 12,
    source_count: 8,
    source: "clean",
  };
  const activity = (groupCode, instructorRow, activityId) => ({
    activity_id: activityId,
    group_code: groupCode,
    course_id: course.course_id,
    course_name_clean: course.course_name_clean,
    course_category: "Visual Analytics",
    instructor_id: instructorRow.instructor_id,
    instructor_name_clean: instructorRow.instructor_name_clean,
    instructor_mapping_status: "MAPPED",
    activity_type: "INTERNAL",
    activity_type_source: "sessions.csv",
    degree: "MBA",
    language: "Arabic",
    num_students: 30,
    day: "Sunday",
    time_slot: "",
    expected_end_date: null,
    last_lecture_date: null,
    grain: "clean_offering",
    status_clean: "COMPLETED",
    status_basis: "EXPLICIT",
  });
  return {
    instructors: [instructor, second],
    courses: [course],
    activities: [
      activity("MBA-G281", instructor, "ACT_00090"),
      activity("MBA-G2272", second, "ACT_02272"),
    ],
    sessions: [{
      session_id: "SES_00433",
      activity_id: "ACT_00090",
      group_code: "MBA-G281",
      course_id: "CRS_003",
      course_name_clean: "Leading with Analytics",
      instructor_id: "INS_001",
      instructor_name_clean: "Ahmed Tealeb",
      instructor_mapping_status: "MAPPED",
      session_number: 2,
      session_date: "2024-01-03",
      date_confidence: "LOW",
      start_time: "5PM",
      duration_hours: 6,
      language: "Arabic",
      activity_type: "EXTERNAL",
      status_clean: "COMPLETED",
      status_basis: "DERIVED_FROM_DATE",
    }],
    feedback: [],
    events: [],
  };
}

export function values(rowNumber, fields) {
  return { rowNumber, values: fields };
}

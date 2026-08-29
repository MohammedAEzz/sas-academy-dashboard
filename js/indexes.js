import { monthKey } from './format.js';

export function buildIndexes(data) {
  const {
    activities, sessions, feedback, instructors, courses,
  } = data;

  const instructorMap = new Map(instructors.map((i) => [i.instructor_id, i]));
  const courseMap = new Map(courses.map((c) => [c.course_id, c]));

  const sessionsByInstructor = new Map();
  const sessionsByGroup = new Map();
  const sessionsByCourse = new Map();
  const sessionsByMonth = new Map();
  const sessionsByActivity = new Map();

  for (const s of sessions) {
    if (s.instructor_id) {
      if (!sessionsByInstructor.has(s.instructor_id)) sessionsByInstructor.set(s.instructor_id, []);
      sessionsByInstructor.get(s.instructor_id).push(s);
    }
    if (s.group_code) {
      if (!sessionsByGroup.has(s.group_code)) sessionsByGroup.set(s.group_code, []);
      sessionsByGroup.get(s.group_code).push(s);
    }
    if (s.course_id) {
      if (!sessionsByCourse.has(s.course_id)) sessionsByCourse.set(s.course_id, []);
      sessionsByCourse.get(s.course_id).push(s);
    }
    if (s.activity_id) {
      if (!sessionsByActivity.has(s.activity_id)) sessionsByActivity.set(s.activity_id, []);
      sessionsByActivity.get(s.activity_id).push(s);
    }
    const mk = monthKey(s.session_date);
    if (mk) {
      if (!sessionsByMonth.has(mk)) sessionsByMonth.set(mk, []);
      sessionsByMonth.get(mk).push(s);
    }
  }

  const activitiesByGroup = new Map();
  for (const a of activities) {
    if (!activitiesByGroup.has(a.group_code)) activitiesByGroup.set(a.group_code, []);
    activitiesByGroup.get(a.group_code).push(a);
  }

  const feedbackByGroup = new Map();
  const feedbackByInstructor = new Map();
  const feedbackByCourse = new Map();
  const mappedFeedback = [];
  const unmappedFeedback = [];

  for (const f of feedback) {
    if (f.group_match_status === 'MAPPED' && f.group_code_clean) {
      if (!feedbackByGroup.has(f.group_code_clean)) feedbackByGroup.set(f.group_code_clean, []);
      feedbackByGroup.get(f.group_code_clean).push(f);
      mappedFeedback.push(f);
    } else {
      unmappedFeedback.push(f);
    }
    if (f.instructor_id) {
      if (!feedbackByInstructor.has(f.instructor_id)) feedbackByInstructor.set(f.instructor_id, []);
      feedbackByInstructor.get(f.instructor_id).push(f);
    }
    if (f.course_id) {
      if (!feedbackByCourse.has(f.course_id)) feedbackByCourse.set(f.course_id, []);
      feedbackByCourse.get(f.course_id).push(f);
    }
  }

  const groupCodes = [...new Set(activities.map((a) => a.group_code).filter(Boolean))].sort();
  const languages = [...new Set(sessions.map((s) => s.language).filter(Boolean))].sort();
  const activityTypes = [...new Set(activities.map((a) => a.activity_type).filter(Boolean))].sort();

  const sessionNameByCourseId = new Map();
  for (const s of sessions) {
    if (s.course_id && s.course_name_clean && !sessionNameByCourseId.has(s.course_id)) {
      sessionNameByCourseId.set(s.course_id, s.course_name_clean);
    }
  }

  return {
    instructorMap,
    courseMap,
    sessionsByInstructor,
    sessionsByGroup,
    sessionsByCourse,
    sessionsByMonth,
    sessionsByActivity,
    activitiesByGroup,
    feedbackByGroup,
    feedbackByInstructor,
    feedbackByCourse,
    mappedFeedback,
    unmappedFeedback,
    groupCodes,
    languages,
    activityTypes,
    instructorName(id) {
      return instructorMap.get(id)?.instructor_name_clean || id;
    },
    courseName(id) {
      return courseMap.get(id)?.course_name_clean
        || sessionNameByCourseId.get(id)
        || 'Unknown Course';
    },
  };
}

export function distinctFeedbackIds(rows) {
  return new Set(rows.map((r) => r.feedback_id));
}

export function dedupeFeedback(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.feedback_id)) return false;
    seen.add(r.feedback_id);
    return true;
  });
}

import { db } from '../firebase/initFirebase.js'
import { doc, getDoc } from 'firebase/firestore'

async function getPage(course_id, section, page) {
  const url = `https://cdn.rawgit.com/w3b3d3v/buildspace-projects/main/${course_id}/ptBR/${section}/${page}`
  const result = await fetch(url)
  const text = await result.text()
  return text
}

async function getCourseLessons(course) {
  if (course == undefined || course.sections == undefined) return []
  let lessons = Object.keys(course.sections)
    .map((section) => {
      return course.sections[section].map((lesson) => {
        return {
          section,
          lesson,
        }
      })
    })
    .flat()

  return await Promise.all(
    lessons.map(async (l) => {
      return { ...l, markdown: await getPage(course.id, l.section, l.lesson) }
    })
  )
}

export async function getCourse(course_id) {
  const docRef = doc(db, 'courses', course_id)
  const courseDoc = await getDoc(docRef)
  const course = { id: course_id, ...courseDoc.data() }
    const lessons = await getCourseLessons(course)
    return { ...course, lessons }
}
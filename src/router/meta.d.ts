import 'vue-router'
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    guestAllowed?: boolean
    adminOnly?: boolean
    layout?: 'app' | 'immersive' | 'auth'
  }
}

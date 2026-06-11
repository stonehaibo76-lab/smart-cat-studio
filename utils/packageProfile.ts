/** True when built with VITE_PACKAGE_PROFILE=portable (green portable zip). */
export function isPortablePackage(): boolean {
  return import.meta.env.VITE_PACKAGE_PROFILE === 'portable';
}

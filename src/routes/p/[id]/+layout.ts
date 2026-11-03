// Interactive pages run in the browser: they need the camera, canvas and the vision worker.
export const ssr = false;

export const load = ({ params }: { params: { id: string } }) => ({ id: params.id });

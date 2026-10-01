import { IvrEditor } from "@/components/dashboard/playground/ivr"
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <IvrEditor id={id} />
}

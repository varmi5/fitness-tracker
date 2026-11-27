import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PHYSIQUE_POSES } from "../../../../lib/physique-data";
import { sharedPhysiquePhotos } from "../../../../lib/physique-share";
import { authConfigured, getDatabase } from "../../../../lib/runtime";
import { SharedPhysiquePlayer } from "./shared-physique-player";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Physique progress · FitnessTrackr",
  description: "A shared physique timelapse from FitnessTrackr.",
  robots: { index: false, follow: false },
};

export default async function SharedPhysique({ params }: { params: Promise<{ token: string }> }) {
  if (!authConfigured()) notFound();
  const { token } = await params;
  const photos = await sharedPhysiquePhotos(getDatabase(), token);
  const tracks = PHYSIQUE_POSES.map((pose) => ({
    pose,
    frames: photos.filter((photo) => photo.pose === pose).map((photo) => ({
      day: photo.day,
      src: `/api/physique/shared/${token}/${photo.id}`,
    })),
  })).filter((track) => track.frames.length > 0);
  if (tracks.length === 0) notFound();
  return (
    <main className="shared-physique">
      <header>
        <p>FitnessTrackr</p>
        <h1>Physique progress</h1>
      </header>
      <SharedPhysiquePlayer tracks={tracks} />
    </main>
  );
}

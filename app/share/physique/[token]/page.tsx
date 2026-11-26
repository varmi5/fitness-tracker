import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sharedPhysiquePhotos } from "../../../../lib/physique-share";
import { authConfigured, getDatabase } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Physique progress · FitnessTrackr",
  description: "A shared progress gallery from FitnessTrackr.",
  robots: { index: false, follow: false },
};

const formatDay = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export default async function SharedPhysique({ params }: { params: Promise<{ token: string }> }) {
  if (!authConfigured()) notFound();
  const { token } = await params;
  const photos = await sharedPhysiquePhotos(getDatabase(), token);
  if (photos.length === 0) notFound();
  return (
    <main className="shared-physique">
      <header>
        <p>FitnessTrackr</p>
        <h1>Physique progress</h1>
      </header>
      <ol className="shared-physique-gallery" aria-label="Progress photos in date order">
        {photos.map((photo, index) => {
          const day = formatDay.format(new Date(`${photo.day}T12:00:00Z`));
          return (
            <li key={photo.id}>
              <figure>
                <img src={`/api/physique/shared/${token}/${photo.id}`} alt={`${photo.pose} progress photo, ${day}`} loading={index < 2 ? "eager" : "lazy"} />
                <figcaption><time dateTime={photo.day}>{day}</time><span>{photo.pose}</span></figcaption>
              </figure>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

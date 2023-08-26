import getPhotos, { type Photo } from "@/server/photos";
import Image from "next/image";
import Link from "next/link";

export default async function About() {
    return (
        <>
            <div className="relative w-full h-[680px] bg-cover bg-center bg-[url('https://res.cloudinary.com/dgpqy3j6f/image/upload/v1693001176/Superstition%20Mountains/Superstition5-27-finals-21.jpg')]">
                <div className="absolute z-10 bottom-0 left-0 min-h-[50%] w-full overflow-hidden bg-gradient-to-t from-[#242424]"></div>
            </div>
            <div className="container flex flex-col mx-auto animate__animated animate__fadeIn scroll-smooth text-white/70">
                <h1 className="text-5xl text-center font-semibold text-white w-full pt-4">
                    Meet Trey McBride
                </h1>
                <p className="pb-4 text-lg text-center text-green-900 italic pt-1">
                    Welcome to Digital Hitchhiker Photography!
                </p>
                <p className="max-w-[900px] w-full mx-auto mb-4 px-4 md:px-0 text-center md:text-left">
                    With 4 years of experience capturing some of the most
                    precious moments our beautiful world has to offer, I
                    specialize in landscape, animal, and portrait photography.
                    Based in Arizona, I&apos;m driven by a passion for
                    storytelling through images, creating photographs that
                    capture not just moments, but emotions.
                </p>
                <p className="max-w-[900px] w-full mx-auto text-center md:text-left px-4 md:px-0 ">
                    Ready to capture your unique story?{" "}
                    <Link
                        href="mailto:tom.fmcbride@gmail.com"
                        className="hover:text-green-900"
                        target="_blank"
                    >
                        Contact me
                    </Link>{" "}
                    to book a session.
                </p>
            </div>
        </>
    );
}

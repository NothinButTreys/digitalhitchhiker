import { TbCameraSearch } from "react-icons/tb";
import {
    BsCamera2,
    BsFacebook,
    BsInstagram,
    BsPersonFillExclamation,
    BsTwitter,
} from "react-icons/bs";
import Link from "next/link";

export default function Nav() {
    return (
        <nav className="bg-[#1d1e22] z-20 shadow-md shadow-slate-950top-0 py-4 px-8 mr-4 w-full fixed h-fit">
            <div className="flex items-center justify-between container mx-auto ">
                <Link
                    href="/"
                    rel="noreferrer"
                    className="text-white/70 hover:text-green-900 transition duration-300 text-2xl flex items-center"
                    aria-label="About the photographer"
                    title="About the photographer"
                >
                    <BsCamera2 className="w-10 h-10 mr-2 " />
                    <h1 className="font-semibold">Digital Hitchhiker</h1>
                </Link>
                {/* <form>
                    <div className="flex items-center bg-[#34363e] rounded-full shadow-sm">
                        <input
                            type="text"
                            placeholder="Search through my albums"
                            className="py-2 px-4 rounded-l-full w-80 text-slate-300 focus:outline-none bg-[#34363e]"
                        />
                        <button
                            type="submit"
                            className="flex justify-center items-center bg-green-900 hover:bg-green-950 rounded-full w-12 h-12  text-slate-300 transition duration-300 focus:outline-none"
                        >
                            <TbCameraSearch className="h-5 w-5" />
                        </button>
                    </div>
                </form> */}
                <div className="flex items-center">
                    <Link
                        href="/about"
                        rel="noreferrer"
                        className="text-white/70 hover:text-green-900 transition duration-300 text-2xl"
                        aria-label="About the photographer"
                        title="About the photographer"
                    >
                        <BsPersonFillExclamation />
                    </Link>
                    {/* <Link
                        href="https://www.facebook.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="ml-6 text-white/70 hover:text-[#4267B2] transition duration-300 text-2xl"
                        aria-label="Facebook Icon Link"
                        title="Facebook Icon Link"
                    >
                        <BsFacebook />
                    </Link>
                    <Link
                        href="https://twitter.com/"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Twitter Icon Link"
                        className="ml-6 text-white/70 hover:text-[#1DA1F2] transition duration-300 text-2xl"
                        title="Twitter Icon Link"
                    >
                        <BsTwitter />
                    </Link> */}
                    <Link
                        href="https://www.instagram.com/digitalhitchhiker/"
                        target="_blank"
                        rel="noreferrer"
                        className="ml-6 text-white/70 hover:text-[#C13584] transition duration-300 text-2xl"
                        aria-label="Instagram Icon Link"
                        title="Instagram Icon Link"
                    >
                        <BsInstagram />
                    </Link>
                </div>
            </div>
        </nav>
    );
}

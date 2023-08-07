
import { TbCameraSearch } from "react-icons/tb";
import { BsCamera2, BsFacebook, BsInstagram, BsTwitter } from "react-icons/bs";
import Link from "next/link";

export default function Nav() {
    return (
        <nav className="bg-[#1d1e22]/[0.99] shadow-md shadow-slate-950 flex justify-between items-center top-0 z-10 py-4 px-8 mr-4 w-full fixed h-fit bg-gradient-to-t from-transparent to-[#1d1e22]/[0.4]">
            <div className="flex items-center">
                <BsCamera2 className="w-12 h-12 mr-2 text-green-900" />
                <h1 className="text-2xl font-semibold text-green-900">
                    Digital Hitchhiker
                </h1>
            </div>
            <form>
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
            </form>
            <div className="flex items-center">
                <Link
                    href="https://www.facebook.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-green-900 hover:text-[#4267B2] transition duration-300 text-2xl"
                    aria-label="Facebook Icon Link"
                >
                    <BsFacebook />
                </Link>
                <Link
                    href="https://twitter.com/"
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Twitter Icon Link"
                    className="ml-6 text-green-900 hover:text-[#1DA1F2] transition duration-300 text-2xl"
                >
                    <BsTwitter />
                </Link>
                <Link
                    href="https://www.instagram.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="ml-6 text-green-900 hover:text-[#C13584] transition duration-300 text-2xl"
                    aria-label="Instagram Icon Link"
                >
                    <BsInstagram />
                </Link>
            </div>
        </nav>
    );
};
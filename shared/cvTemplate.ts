// Preamble of the résumé LaTeX template. Every tailored CV is rendered with exactly this preamble
// and the macros it defines (see shared/cv.ts for the body renderer).

export const TEMPLATE_PREAMBLE = String.raw`%-------------------------
% Resume in Latex
% Author : andythropic
%------------------------

\documentclass[letterpaper,11pt]{article}

\usepackage[T1]{fontenc}
\usepackage[scaled]{helvet}
\renewcommand{\familydefault}{\sfdefault}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage[usenames,dvipsnames]{color}
\usepackage{xcolor} % for custom named colors

% Define your accent color here:
\definecolor{AccentColor}{RGB}{0, 32, 96} % Navy Blue
% Or use: {RGB}{0, 100, 0} for Dark Green
% Or use: {RGB}{128, 0, 32} for Burgundy

\usepackage{verbatim}
\usepackage{enumitem}
\usepackage{hyperref}
\definecolor{LinkColor}{RGB}{0, 102, 204} % Blue for hyperlinks
\hypersetup{colorlinks=true, urlcolor=LinkColor, linkcolor=LinkColor}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\usepackage{graphicx}
\usepackage{tikz}
\usetikzlibrary{shadows}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

% Adjust margins
\addtolength{\oddsidemargin}{-0.7in}
\addtolength{\evensidemargin}{-0.7in}
\addtolength{\textwidth}{1.4in}
\addtolength{\topmargin}{-.7in}
\addtolength{\textheight}{1.4in}

\urlstyle{same}

\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}
  {\color{black}\vspace{-4pt}\scshape\raggedright\large}
  {}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\pdfgentounicode=1
\titlespacing*{\section}{0pt}{10pt plus 1pt minus 1pt}{14pt plus 1pt minus 1pt}

%-------------------------
% Custom commands
\newcommand{\resumeItem}[1]{\item\small{{#1 \vspace{-2pt}}}}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
  \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
    \textbf{#1} & #2 \\
    \textit{\small#3} & \textit{\small #4} \\
  \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubheadingSpaced}[4]{
  \vspace{1pt}\item
  \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
    \textbf{#1} & #2 \\
    \textit{\small#3} & \textit{\small #4} \\
  \end{tabular*}\vspace{-2pt}
}

\newcommand{\resumeProjectHeading}[2]{
  \item
  \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
    \small#1 & #2
  \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeadingSpaced}[2]{
  \item
  \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
    \small#1 & #2
  \end{tabular*}\vspace{-2pt}
}

% Wrapping variant: left column wraps instead of overflowing into the date.
% The X column lets the title wrap; internal \\ forces a break (e.g. before STEI ITB).
\newcommand{\resumeProjectHeadingWrap}[2]{
  \item
  \begin{tabularx}{0.97\textwidth}{@{}>{\raggedright\arraybackslash}X@{\hspace{0.4cm}}r@{}}
    \small #1 & \small#2
  \end{tabularx}\vspace{-2pt}
}

\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListStartSpaced}{\begin{itemize}[leftmargin=0.15in, label={}, itemsep=8pt, topsep=4pt]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}[leftmargin=*,itemsep=0pt,topsep=2pt]}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

% Profile photo settings (resize by changing \ProfilePhotoSize)
\newcommand{\ProfilePhotoSize}{2.35cm}
\newcommand{\ProfilePhotoFile}{ELSDSd1.png}
\newcommand{\HeaderTextShift}{1.0cm}
\newcommand{\HeaderBlockShift}{1.7cm}

\newcommand{\ResumeProfilePhoto}{
  \begin{tikzpicture}[baseline=(photo.center)]
    \node[
      inner sep=0pt,
      outer sep=0pt,
    ] (photo) {\includegraphics[width=\ProfilePhotoSize,height=\ProfilePhotoSize,keepaspectratio]{\ProfilePhotoFile}};
  \end{tikzpicture}
}

%-------------------------------------------
%%%%%%  RESUME STARTS HERE  %%%%%%%%%%%%%%%%%%%%%%%%%%%%
`;

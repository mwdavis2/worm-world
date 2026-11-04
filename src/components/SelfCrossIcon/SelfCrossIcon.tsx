interface SelfCrossIconProps {
  className?: string;
}

// The lab's self-cross mark: a line heading down that curls once
// counter-clockwise on the way, with the cross X inside the curl (the X is the
// one the mated cross shows, scaled to fit). Drawn in the current text color.
const SelfCrossIcon = (props: SelfCrossIconProps): React.JSX.Element => {
  return (
    <svg
      viewBox='0 0 24 24'
      className={props.className}
      role='img'
      aria-label='Self cross'
    >
      <g
        fill='none'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <path d='M7.5 1.5V10A5.8 5.8 0 0 0 19.1 10A5.8 5.8 0 0 0 7.5 10V22' />
        <path d='M4.3 19L7.5 22.3L10.7 19' />
      </g>
      <path
        fill='currentColor'
        transform='translate(13.3 10) scale(0.46) translate(-12 -12)'
        d='m16.192 6.344-4.243 4.242-4.242-4.242-1.414 1.414L10.535 12l-4.242 4.242 1.414 1.414 4.242-4.242 4.243 4.242 1.414-1.414L13.363 12l4.243-4.242z'
      />
    </svg>
  );
};

export default SelfCrossIcon;

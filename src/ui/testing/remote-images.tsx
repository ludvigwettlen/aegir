import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ChatMarkdown } from '../design-system/ChatMarkdown';
function Fixture() {
  const [image, setImage] = useState('first');
  return <>
    <button onClick={() => setImage(value => value === 'first' ? 'second' : 'first')}>Change image</button>
    <ChatMarkdown content={`![Private preview](/unused)\n\n![Remote preview](http://127.0.0.1:${location.port}/${image}.png)`} onOpenLink={() => {}} />
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

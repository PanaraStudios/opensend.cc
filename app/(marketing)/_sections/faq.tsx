import { Reveal } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { FAQ } from "@/content/landing"

/* FAQ: six items in the shared accordion (1px double-border dividers, the
   plus icon rotates to a cross). */
export function Faq() {
  return (
    <section id="faq" className="section scroll-mt-16 px-6 md:px-10">
      <SectionHeader
        title={
          <>
            {FAQ.titleA} <em>{FAQ.titleEm}</em>
          </>
        }
      />
      <Reveal className="mx-auto mt-14 max-w-2xl">
        <Accordion className="border-double-t">
          {FAQ.items.map((item) => (
            <AccordionItem key={item.q} value={item.q}>
              <AccordionTrigger
                data-umami-event="faq_open"
                data-umami-event-question={item.q}
              >
                {item.q}
              </AccordionTrigger>
              <AccordionContent>
                <p>{item.a}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Reveal>
    </section>
  )
}

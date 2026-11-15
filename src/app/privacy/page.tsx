// Public privacy notice (Thai + English), linked from the automatic LINE notice (line/notice.ts).
// Public route (see proxy.ts). Static text only: no data access, no session. Not legal advice.
import type { ReactNode } from "react";

export const metadata = { title: "Privacy / นโยบายความเป็นส่วนตัว" };

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mt-6">
    <h3 className="text-base font-semibold">{title}</h3>
    <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
  </section>
);

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">นโยบายความเป็นส่วนตัว / Privacy notice</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        ระบบนี้เป็นระบบสาธิตภายในของทีมขาย / This is an internal demo CRM for a sales team.
      </p>

      <article lang="th" className="mt-8">
        <h2 className="text-xl font-semibold">ภาษาไทย</h2>
        <Section title="ข้อมูลที่เราเก็บจาก LINE">
          <p>
            เมื่อคุณส่งข้อความหาบัญชี LINE Official Account ของเรา เราเก็บ: LINE user ID, ชื่อที่แสดงใน LINE, เนื้อหาข้อความที่คุณส่ง
            เวลาที่ส่ง และปุ่มตอบกลับด่วนที่คุณกด (เช่น “นัดคุย”) รวมถึงข้อความที่ทีมขายตอบกลับคุณ
          </p>
          <p>ระบบเก็บข้อมูลเหตุการณ์ดิบที่ LINE ส่งมาเพื่อกันการประมวลผลซ้ำและตรวจสอบย้อนหลังด้วย</p>
        </Section>
        <Section title="เก็บไปทำไม">
          <p>เพื่อตอบคำถามของคุณและติดต่อกลับเรื่องบริการเท่านั้น และเพื่อให้ทีมขายดูประวัติการสนทนาได้ในที่เดียว</p>
          <p>
            ระบบอาจใช้ AI ช่วยสรุปบทสนทนาและร่างข้อความตอบให้พนักงานดู โดยส่งชื่อ เนื้อหาข้อความ และบันทึกของทีมขายเกี่ยวกับคุณไปยังผู้ให้บริการ AI ภายนอก (Anthropic) เราพยายามตัดเบอร์โทรและอีเมลออกก่อนส่ง แต่การตัดอัตโนมัติอาจไม่ครบทุกรูปแบบ
            AI ไม่ส่งข้อความหาคุณเอง คำตอบจากทีมขายทุกข้อความต้องผ่านการอนุมัติจากพนักงาน ข้อความอัตโนมัติเพียงข้อความเดียวคือประกาศความเป็นส่วนตัวที่ส่งเมื่อคุณทักครั้งแรก
          </p>
        </Section>
        <Section title="เก็บนานแค่ไหน">
          <p>
            เราเก็บข้อมูล LINE ตราบที่ลูกค้ารายนั้น (lead) ยังอยู่ระหว่างการติดตาม และจะลบภายใน 30 วันนับจากที่คุณขอให้ลบ
            ปัจจุบันการลบทำโดยเจ้าหน้าที่ด้วยตนเอง ระบบยังไม่ลบข้อมูลอัตโนมัติ
          </p>
        </Section>
        <Section title="ขอให้ลบข้อมูลได้อย่างไร">
          <p>พิมพ์แจ้งในแชท LINE นี้ว่าต้องการให้ลบข้อมูล เจ้าหน้าที่จะลบหรือทำให้ข้อมูลไม่สามารถระบุตัวคุณได้ (anonymise) ด้วยตนเอง</p>
          <p>บันทึกการดำเนินการ (audit trail) แก้ไขหรือลบไม่ได้ จึงยังอยู่ เราจะลบข้อมูลที่ระบุตัวคุณออกให้มากที่สุดเท่าที่ทำได้</p>
        </Section>
      </article>

      <article lang="en" className="mt-10 border-t pt-8">
        <h2 className="text-xl font-semibold">English</h2>
        <Section title="What LINE data we store">
          <p>
            When you message our LINE Official Account we store: your LINE user ID, your LINE display name, the content and time of
            your messages, the quick-reply buttons you tap (for example “Book a call”), and the replies our sales team sends you.
          </p>
          <p>We also keep the raw event LINE delivers, so that the same event is never processed twice and for audit.</p>
        </Section>
        <Section title="Why">
          <p>Only to answer your questions and follow up about our services, and so the sales team can see the conversation in one place.</p>
          <p>
            An AI model may help summarise the conversation and draft a reply for a staff member to review. Your name, message text and the sales team&rsquo;s notes about you are sent to an external AI provider
            (Anthropic) for this. We try to remove phone numbers and emails first, but automatic removal may miss some formats. The AI never messages you by itself: every reply from the sales
            team is approved by a person. The only automatic message is the privacy notice sent when you first write to us.
          </p>
        </Section>
        <Section title="How long">
          <p>
            We keep LINE data while your enquiry (lead) is active, and delete it within 30 days of your request.
            Deletion is currently done by staff by hand; the system does not delete data automatically yet.
          </p>
        </Section>
        <Section title="How to ask for deletion">
          <p>
            Reply in the LINE chat and say you want your data deleted. A staff member will delete or anonymise the data that
            identifies you manually. The audit trail of actions cannot be edited or deleted, so it stays; we remove what identifies you as far as we can.
          </p>
        </Section>
      </article>
    </main>
  );
}

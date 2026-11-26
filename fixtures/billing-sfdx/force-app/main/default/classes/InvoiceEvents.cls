/**
 * Writes records whose object is known only when the code runs, reads the billing settings, and tells the org
 * when invoices are paid.
 */
public with sharing class InvoiceEvents {
    public static void saveAll(List<SObject> records) {
        update records;
    }

    public static List<Database.SaveResult> insertLines(List<Invoice_Line__c> lines) {
        Database.DMLOptions options = new Database.DMLOptions();
        options.allowFieldTruncation = true;
        return Database.insert(lines, options);
    }

    public static void publishPaid(Set<Id> invoiceIds) {
        List<Invoice_Paid__e> events = new List<Invoice_Paid__e>();
        for (Id invoiceId : invoiceIds) {
            events.add(new Invoice_Paid__e(Invoice_Id__c = invoiceId));
        }
        EventBus.publish(events);
    }

    public static Decimal lateFee(Invoice__c invoice) {
        Billing_Settings__c settings = Billing_Settings__c.getInstance();
        Billing_Settings__c defaults = Billing_Settings__c.getOrgDefaults();
        Decimal percent = settings.Late_Fee_Percent__c ?? defaults.Late_Fee_Percent__c;
        return invoice.Amount__c * percent / 100;
    }

    public static Integer graceDays() {
        return Billing_Settings__c.getOrgDefaults().Grace_Days__c?.intValue() ?? 0;
    }

    public static String invoiceLabel() {
        return Schema.describeSObjects(new List<String>{ 'Invoice__c' })[0].getLabel();
    }

    public static Schema.DescribeSObjectResult describeByName(String objectName) {
        return Schema.getGlobalDescribe().get(objectName).getDescribe();
    }

    public static String stage(Invoice__c invoice) {
        switch on invoice.Status__c {
            when 'Draft', 'Sent' {
                return 'open';
            }
            when 'Paid' {
                return 'closed';
            }
            when else {
                return 'other';
            }
        }
    }
}

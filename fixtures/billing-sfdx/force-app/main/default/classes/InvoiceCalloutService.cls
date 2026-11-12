/**
 * Sends an invoice to the billing gateway through a named credential.
 */
public with sharing class InvoiceCalloutService {
    public static Integer send(Invoice__c invoice) {
        HttpRequest request = new HttpRequest();
        request.setEndpoint('callout:Billing_Gateway/invoices');
        request.setMethod('POST');
        request.setHeader('Content-Type', 'application/json');
        request.setBody(JSON.serialize(new Map<String, Object>{
            'externalId' => invoice.External_Id__c,
            'total' => invoice.Grand_Total__c,
            'owner' => invoice.Owner_Manager_Email__c
        }));
        HttpResponse response = new Http().send(request);
        return response.getStatusCode();
    }
}
